import type { Tables, Enums  } from "@/types/supabase";

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


export type DeliveryState = "sending" | "sent" | "delivered" | "read";
// sending: id negativo (optimista)
// sent:    guardado en DB (id >= 0)
// read:    existe al menos un receipt.read_at de un usuario != autor

export type MessageMeta = {
 localDelivery?: DeliveryState;
  readBy?: Set<string>;           // usuarios (id/username) que lo leyeron
};

export type ThreadRow       = Tables<'review_threads'>;
export type MessageRow      = Tables<'review_messages'>;
export type ImageStatusRow  = Tables<'review_images_status'>;
export type SkuStatusRow    = Tables<'review_skus_status'>;
export type MessageMetaRow     = Tables<'review_message_receipts'>;

export type ThreadStatusEnum = Enums<'thread_status'>;   // 'pending' | 'corrected' | 'reopened' | 'deleted'
export type ImageStatusEnum  = Enums<'image_status'>;    // 'finished' | 'needs_correction'
export type SkuStatusEnum    = Enums<'sku_status'>;      // 'pending_validation' | ...