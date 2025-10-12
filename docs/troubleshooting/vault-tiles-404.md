# Vault tile 404s in local/dev environments

When loading the document vault UI locally you may see console errors like:

```
GET https://www.phloat.io/api/vault/tiles 404 (Not Found)
GET https://www.phloat.io/api/vault/payslips/employers 404 (Not Found)
GET https://www.phloat.io/api/vault/statements/institutions 404 (Not Found)
```

These requests are emitted by the front-end while it tries to populate the new dashboard tiles and dropdowns (`frontend/js/vault.js`). Those features expect extra catalogue endpoints under `/api/vault/...`, but the open-source backend (`backend/src/routes/vault.routes.js`) currently ships without handlers for `/tiles`, `/payslips/*`, or `/statements/*`. As a result the requests fall through Express' routing and come back as `404`.

In production the missing endpoints are provided by a separate internal service. They are not part of the OSS bundle, so the errors are expected during local development and can be ignored. Alternatively, stub the endpoints in your dev server if you want to eliminate the warnings.
