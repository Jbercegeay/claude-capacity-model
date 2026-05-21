import { api } from '../../data/api.js';

export async function renderOracleUpload(container) {
  let status = null;

  async function loadStatus() {
    try {
      status = await api.oracleForecast();
    } catch (e) {
      status = { available: false };
    }
  }

  async function render() {
    await loadStatus();
    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Oracle Forecast Upload</h1>
        <p class="view-subtitle">Upload a TRN .xlsm file to update the active Oracle forecast</p>
      </div>

      ${status?.available ? `
        <div class="card animate-in" style="margin-bottom:var(--space-md);border-left:3px solid var(--status-good);">
          <div style="font-weight:700;color:var(--status-good);margin-bottom:6px;">Active Forecast</div>
          <div style="font-size:13px;color:var(--text-secondary);">File: <strong>${status.fileName}</strong></div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Uploaded: ${status.uploadedAt}</div>
        </div>
      ` : `
        <div class="warn-banner animate-in">No Oracle forecast uploaded yet.</div>
      `}

      <div class="card animate-in">
        <label class="upload-zone" id="oracle-drop">
          <input type="file" id="oracle-file" accept=".xlsm,.xlsx" />
          <span class="upload-icon">📥</span>
          <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Drop TRN .xlsm here</div>
          <div style="font-size:13px;color:var(--text-muted);">or click to browse — Oracle forecast export</div>
        </label>
        <div id="oracle-status" style="margin-top:var(--space-md);"></div>
      </div>
    `;

    const fileInput = container.querySelector('#oracle-file');
    const statusDiv = container.querySelector('#oracle-status');

    async function handleFile(file) {
      if (!file) return;
      statusDiv.innerHTML = `<div class="info-banner">Uploading <strong>${file.name}</strong>…</div>`;
      try {
        const res = await api.uploadOracle(file);
        statusDiv.innerHTML = `
          <div class="card" style="border-left:3px solid var(--status-good);">
            <div style="font-weight:700;color:var(--status-good);margin-bottom:8px;">Upload successful</div>
            <div style="font-size:13px;color:var(--text-secondary);">
              Year: <strong>${res.year}</strong> ·
              Firm PO rows: <strong>${res.firmPORows}</strong> ·
              Forecast rows: <strong>${res.forecastRows}</strong>
            </div>
          </div>
        `;
        await loadStatus();
      } catch (err) {
        statusDiv.innerHTML = `<div class="error-banner">Upload failed: ${err.message}</div>`;
      }
    }

    fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

    const dropZone = container.querySelector('#oracle-drop');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });
  }

  await render();
}
