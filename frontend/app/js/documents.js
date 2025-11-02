document.addEventListener('DOMContentLoaded', async () => {
  await App.bootstrap('documents');
  const fileInput = document.getElementById('file-input');
  const uploadLog = document.getElementById('upload-log');

  function appendLog(message) {
    uploadLog.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    uploadLog.insertAdjacentHTML('afterbegin', `<p>[${time}] ${message}</p>`);
  }

  async function refresh() {
    const data = await App.Api.getBatches();
    const container = document.getElementById('batches-list');
    const batches = data.batches || [];
    if (!batches.length) {
      container.className = 'empty-state';
      container.textContent = 'No uploads yet. Drop a PDF or ZIP to begin.';
    } else {
      container.className = '';
      container.innerHTML = batches.map((batch) => {
        const files = batch.files.map((file) => {
          const children = (file.children || []).map((child) => `
            <div class="status-pill ${child.status}">${child.filename} · ${child.status}</div>`).join('');
          return `
            <div class="card" style="margin-top:12px;">
              <strong>${file.filename}</strong>
              <div style="margin-top:8px;" class="status-pill ${file.status}">${file.status}${file.message ? ` · ${file.message}` : ''}</div>
              ${children ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">${children}</div>` : ''}
            </div>`;
        }).join('');
        return `
          <section style="margin-bottom:24px;">
            <h4>Batch ${batch.batchId} <span class="status-pill ${batch.status}">${batch.status}</span></h4>
            ${batch.summary ? `<p class="subtitle">Processed ${batch.summary.processed}, failed ${batch.summary.failed}, skipped ${batch.summary.skipped}</p>` : ''}
            <div style="display:flex;flex-direction:column;gap:12px;">${files}</div>
          </section>`;
      }).join('');
    }

    const deadLetters = data.deadLetters || [];
    const deadCard = document.getElementById('dead-letter-card');
    const deadTable = document.querySelector('#dead-letter-table tbody');
    deadTable.innerHTML = '';
    if (deadLetters.length) {
      deadCard.style.display = 'block';
      deadLetters.forEach((job) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${job.fileId}</td>
          <td>${job.stage}</td>
          <td>${job.reason}</td>
          <td><button class="button" data-requeue="${job._id}">Requeue</button></td>`;
        deadTable.appendChild(tr);
      });
    } else {
      deadCard.style.display = 'none';
    }
  }

  async function uploadFiles(fileList) {
    if (!fileList.length) return;
    let batchId = null;
    const ingestions = [];
    for (const file of fileList) {
      const lower = file.name.toLowerCase();
      let contentType = file.type;
      if (!contentType) {
        if (lower.endsWith('.pdf')) contentType = 'application/pdf';
        if (lower.endsWith('.zip')) contentType = 'application/zip';
      }
      const payload = {
        filename: file.name,
        contentType,
        size: file.size,
      };
      if (batchId) payload.batchId = batchId;
      const { batchId: returnedBatchId, fileId, upload } = await App.Api.presign(payload);
      batchId = returnedBatchId;
      appendLog(`Uploading ${file.name} to batch ${batchId}`);
      const res = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      });
      if (!res.ok) {
        appendLog(`Failed to upload ${file.name}`);
        continue;
      }
      appendLog(`Uploaded ${file.name}`);
      ingestions.push({ fileId });
    }
    if (batchId && ingestions.length) {
      appendLog(`Queueing Docupipe ingestion for batch ${batchId}`);
      await App.Api.ingest({ batchId, files: ingestions });
      appendLog(`Queued ${ingestions.length} file(s)`);
    }
    await refresh();
  }

  fileInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    uploadFiles(files).catch((err) => appendLog(`Error: ${err.message}`));
    event.target.value = '';
  });

  document.getElementById('dead-letter-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-requeue]');
    if (!button) return;
    const id = button.dataset.requeue;
    button.disabled = true;
    App.Api.requeue(id)
      .then(() => {
        appendLog(`Requeued job ${id}`);
        return refresh();
      })
      .catch((err) => {
        appendLog(`Failed to requeue: ${err.message}`);
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  refresh();
});
