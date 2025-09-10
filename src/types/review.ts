export interface Annotation {
  id: number;
  x: number; // %
  y: number; // %
  comment: string;
}

export type AnnotationState = Record<string, Annotation[]>;
export type ValidationState = Record<string, boolean>;

export interface ImageItem {
  url: string;
  filename: string;
}

export interface SkuData {
  sku: string;
  images: ImageItem[];
  allReviewed?: boolean;
}
