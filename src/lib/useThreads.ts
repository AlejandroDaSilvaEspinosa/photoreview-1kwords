"use client";
import { useCallback, useState } from "react";
import type {
  AnnotationState,
  AnnotationThread,
  AnnotationMessage,
  ThreadStatus,
  ImageItem,
} from "@/types/review";

type ReviewsPayload = Record<string, { points?: AnnotationThread[] }>;
const ThreadStatus = {
  pending: "pending" as ThreadStatus,
  corrected: "corrected" as ThreadStatus,
  reopened: "reopened" as ThreadStatus,
};
export function useThreads(sku: string, images: ImageItem[]) {
  const [annotations, setAnnotations] = useState<AnnotationState>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/reviews/${encodeURIComponent(sku)}`);
    if (!res.ok) return;
    const payload: ReviewsPayload = await res.json();
    const merged: AnnotationState = {};
    for (const img of images) {
      if (!img.name) continue;
      merged[img.name] = payload[img.name]?.points ?? [];
    }
    setAnnotations(merged);
  }, [sku, images]);

  const createThread = useCallback(
    async (imageName: string, x: number, y: number) => {
      const tempId = -Date.now();
      const tempThread: AnnotationThread = {
        id: tempId,
        x,
        y,
        status: ThreadStatus.pending,
        messages: [],
      };
      setAnnotations((p) => ({
        ...p,
        [imageName]: [...(p[imageName] || []), tempThread],
      }));

      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, imageName, x, y }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const realId: number | undefined = data?.threadId;

      if (realId) {
        setAnnotations((p) => ({
          ...p,
          [imageName]: (p[imageName] || []).map((t) =>
            t.id === tempId ? { ...t, id: realId } : t
          ),
        }));
      }
    },
    [sku]
  );

  const addMessage = useCallback(
    async (imageName: string, threadId: number, text: string) => {
      const tempId = -Date.now();
      const tempMsg: AnnotationMessage = {
        id: tempId,
        text,
        createdAt: new Date().toISOString(),
      };

      setAnnotations((p) => ({
        ...p,
        [imageName]: (p[imageName] || []).map((t) =>
          t.id === threadId
            ? { ...t, messages: [...t.messages, tempMsg] }
            : t
        ),
      }));

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const realId: number | undefined = data?.messageId;

      if (realId) {
        setAnnotations((p) => ({
          ...p,
          [imageName]: (p[imageName] || []).map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === tempId ? { ...m, id: realId } : m
                  ),
                }
              : t
          ),
        }));
      }
    },
    []
  );

  const setThreadStatus = useCallback(
    async (
      imageName: string,
      threadId: number,
      status: ThreadStatus
    ) => {
      setAnnotations((p) => ({
        ...p,
        [imageName]: (p[imageName] || []).map((t) =>
          t.id === threadId ? { ...t, status } : t
        ),
      }));
      await fetch("/api/threads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, status }),
      });
    },
    []
  );

  return { annotations, setAnnotations, load, createThread, addMessage, setThreadStatus };
}
