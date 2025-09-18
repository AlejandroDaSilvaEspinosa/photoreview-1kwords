export interface ThreadMessage {
  id: number;        // único dentro del thread
  text: string;
  createdAt: string; // ISO
  author?: string;   // opcional
  isSystem?: boolean;
  createdByName?:string;
}

export interface Thread {
  id: number;        // id del punto
  x: number;         // %
  y: number;         // %
  messages: ThreadMessage[];
  status: ThreadStatus;
}

export type ThreadStatus = "pending" | "corrected" | "reopened" | "deleted";
export type ThreadState = Record<string, Thread[]>;
export type ValidationState = Record<string, boolean>;

export interface ImageItem {
  url: string;
  name: string;
  listingImageUrl: string;
  thumbnailUrl: string;
  bigImgUrl: string;
}

export interface SkuWithImages  { sku: string; images: ImageItem[] };

export interface SkuData {
  sku: string;
  images: ImageItem[];
  allReviewed?: boolean;
}

export interface ReviewJSON {
  revision: number;
  points: Thread[];
}

export interface ReviewsBySkuResponse {
  sku: string;
  revision: number; // última revisión encontrada
  items: Array<{
    name: string;
    points: Thread[];
  }>;
}
