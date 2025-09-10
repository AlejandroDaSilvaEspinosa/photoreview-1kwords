// src/lib/google.ts
import { google, drive_v3, sheets_v4 } from "googleapis";

function loadServiceAccount(): any | null {
  const b64 = process.env.GOOGLE_CREDENTIALS_B64;
  const raw = process.env.GOOGLE_CREDENTIALS;

  let json: string | null = null;

  if (b64) {
    json = Buffer.from(b64, "base64").toString("utf8");
  } else if (raw) {
    json = raw;
  } else {
    return null;
  }

  let creds = JSON.parse(json);

  // Normaliza la private_key: convierte \n literales a saltos reales y quita posibles comillas envolventes
  if (typeof creds.private_key === "string") {
    let k = creds.private_key.trim();
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
      k = k.slice(1, -1);
    }
    // Si viene con backslash-n, pásalos a saltos reales
    k = k.replace(/\\n/g, "\n");
    creds.private_key = k;
  }

  return creds;
}

const credentials = loadServiceAccount();

export const auth = new google.auth.GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
  ...(credentials
    ? { credentials }
    : { keyFile: "credentials.json" }), // fallback local
});

export const drive: drive_v3.Drive = google.drive({ version: "v3", auth });
export const sheets: sheets_v4.Sheets = google.sheets({ version: "v4", auth });
