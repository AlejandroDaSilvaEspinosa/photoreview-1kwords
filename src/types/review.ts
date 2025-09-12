export interface AnnotationMessage {
  id: number;        // único dentro del thread
  text: string;
  createdAt: string; // ISO
  author?: string;   // opcional
}

export interface AnnotationThread {
  id: number;        // id del punto
  x: number;         // %
  y: number;         // %
  messages: AnnotationMessage[];
}

export type AnnotationState = Record<string, AnnotationThread[]>;
export type ValidationState = Record<string, boolean>;

export interface ImageItem {
  sku: string | null;
  url: string | null;
  name: string | null;
  listingImageUrl: string;
  thumbnailUrl: string;
}

export interface SkuData {
  sku: string;
  images: ImageItem[];
  allReviewed?: boolean;
}

export interface ReviewJSON {
  revision: number;
  points: AnnotationThread[];
}

export interface ReviewsBySkuResponse {
  sku: string;
  revision: number; // última revisión encontrada
  items: Array<{
    filename: string;
    points: AnnotationThread[];
  }>;
}
