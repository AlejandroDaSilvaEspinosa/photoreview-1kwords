import { google, drive_v3, sheets_v4 } from "googleapis";

function loadServiceAccount() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) return null;

  // Puede venir como JSON o como string JSON escapado
  let parsed: any = null;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    // Si falla JSON.parse, asumimos que ya es objeto o está mal formado
    parsed = raw as any;
  }

  // Normalizamos saltos de línea en la private_key
  if (parsed?.private_key && typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

const credentials = loadServiceAccount();

export const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",  // ← escritura/lectura Sheets
    "https://www.googleapis.com/auth/drive.readonly" // ← si listáis/mostráis cosas desde Drive
  ],
  ...(credentials ? { credentials } : { keyFile: "credentials.json" }),
});

export const sheets: sheets_v4.Sheets = google.sheets({ version: "v4", auth });
export const drive: drive_v3.Drive  = google.drive({ version: "v3", auth });
