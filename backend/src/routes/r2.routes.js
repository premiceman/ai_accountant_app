// backend/src/routes/r2.routes.js
const express = require("express");
const crypto = require("crypto");
const auth = require("../../middleware/auth");
const { presignPut, presignGet, headObject, getObjectBuffer } = require("../utils/r2");
const { enqueue } = require("../utils/queues");
const Document = require("../../models/Document");
const Extraction = require("../../models/Extraction");
const Transaction = require("../../models/Transaction");
const PayrollFact = require("../../models/PayrollFact");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();
router.use(auth);

// reuse S3 client
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

function makeKey({ userId, collectionId, filename }) {
  const base = `${userId}/${collectionId || "uncategorised"}`;
  const uid = crypto.randomUUID();
  const ext = (filename || "").split(".").pop();
  return `vault/${base}/${uid}.${ext || "bin"}`;
}

// 1) PRESIGN
router.post("/presign", async (req, res) => {
  try {
    const { filename, mime, size, typeHint, collectionId } = req.body;
    if (!filename || !mime || !size) return res.status(400).json({ error: "filename, mime, size required" });

    const Key = makeKey({ userId: req.user._id, collectionId, filename });
    const url = await presignPut({ Key, ContentType: mime, expiresIn: 900 });

    const doc = await Document.create({
      userId: req.user._id,
      collectionId, typeHint: typeHint || "other",
      filename,
      storage: { provider: "r2", key: Key, size, mime }
    });

    res.json({ docId: doc._id, putUrl: url, key: Key });
  } catch (e) {
    console.error("presign error", e);
    res.status(500).json({ error: "presign failed" });
  }
});

// 2) COMMIT
router.post("/:id/commit", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Document.findOne({ _id: id, userId: req.user._id });
    if (!doc) return res.status(404).json({ error: "not found" });

    await headObject(doc.storage.key).catch(() => { throw new Error("object missing in R2"); });

    const buf = await getObjectBuffer(doc.storage.key);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    doc.storage.sha256 = sha256;
    await doc.save();

    await enqueue({ event: "validate", docId: String(doc._id), key: doc.storage.key, userId: String(doc.userId) });
    res.json({ ok: true });
  } catch (e) {
    console.error("commit error", e);
    res.status(400).json({ error: e.message || "commit failed" });
  }
});

// 3) PREVIEW
router.get("/:id/preview", async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doc) return res.status(404).end();
    const url = await presignGet({ Key: doc.storage.key, expiresIn: 300 });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: "preview failed" });
  }
});

// 4) LIST FILES (R2)
router.get("/collections/:collectionId/files", async (req, res) => {
  try {
    const { collectionId } = req.params;
    const q = { userId: req.user._id };
    if (collectionId && collectionId !== "all" && collectionId !== "undefined") {
      q.collectionId = collectionId;
    }
    const docs = await Document.find(q).sort({ createdAt: -1 }).lean();
    const files = docs.map(d => ({
      id: String(d._id),
      r2DocId: String(d._id),
      name: d.filename || (d.storage?.key ? String(d.storage.key).split("/").pop() : "document.pdf"),
      size: d.storage?.size || 0,
      uploadedAt: d.createdAt,
      status: d.status
    }));
    res.json(files);
  } catch (e) {
    console.error("list r2 files error", e);
    res.status(500).json({ error: "failed to list files" });
  }
});

// 5) DELETE (R2)
router.delete("/files/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Document.findOne({ _id: id, userId: req.user._id });
    if (!doc) return res.status(404).json({ error: "not found" });

    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: doc.storage.key })).catch(() => null);

    await Promise.allSettled([
      Extraction.deleteOne({ docId: doc._id }),
      Transaction.deleteMany({ docId: doc._id }),
      PayrollFact.deleteMany({ docId: doc._id })
    ]);

    await doc.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    console.error("delete r2 file error", e);
    res.status(500).json({ error: "delete failed" });
  }
});

module.exports = router;
