// Imagen
export type ImageStatus = "finished" | "needs_correction";

// SKU
export type SkuStatus = "pending_validation" | "needs_correction" | "validated" | "reopened";

export interface ImageItem {
  url: string;
  name: string;
  listingImageUrl: string;
  thumbnailUrl: string;
  bigImgUrl: string;
}

export interface ImageItemWithStatus extends ImageItem {
  status: ImageStatus;
}

export interface SkuWithImages {
  sku: string;
  images: ImageItem[];
}

export interface SkuWithImagesAndStatus extends SkuWithImages {
  status: SkuStatus;
  images: ImageItemWithStatus[];
  counts: {
    finished: number;
    needs_correction: number;
    total: number;
  };
}


export interface ThreadMessage {
  id: number;        // único dentro del thread
  text: string;
  createdAt: string; // ISO
  author?: string;   // opcional
  isSystem?: boolean;
  createdByName?:string;
  meta?:MessageMeta
}

export interface Thread {
  id: number;        // id del punto
  x: number;         // %
  y: number;         // %
  messages?: ThreadMessage[];
  status: ThreadStatus;
}

export type ThreadStatus = "pending" | "corrected" | "reopened" | "deleted";
export type ThreadState = Record<string, Thread[]>;
export type ValidationState = Record<string, boolean>;


export type DeliveryState = "sending" | "sent" | "read"; 
// sending: id negativo (optimista)
// sent:    guardado en DB (id >= 0)
// read:    existe al menos un receipt.read_at de un usuario != autor

export type MessageMeta = {
  localDelivery?: DeliveryState;
  readBy?: Set<string>;           // usuarios (id/username) que lo leyeron
};