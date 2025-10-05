"use client";

import React from "react";
import styles from "./SidePanelZoomOverlay.module.css";
import Minimap from "./Minimap";
import ThreadsPanel from "@/components/ThreadsPanel";
import type { Thread, ThreadStatus } from "@/types/review";

type Props = {
  src: string;
  miniAspect?: string;
  imgW: number;
  imgH: number;
  cx: number;
  cy: number;
  zoom: number;
  viewportPx: { vw: number; vh: number };
  onMoveViewport: (xPct: number, yPct: number) => void;

  threads: Thread[];
  activeThreadId: number | null;
  validationLock: boolean;
  pendingStatusIds?: Set<number>;
  onAddThreadMessage: (threadId: number, text: string) => void;
  onFocusThread: (id: number | null) => void;
  centerToThread: (t: Thread) => void;
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;
};

export default function SidePanelZoomOverlay({
  src,
  miniAspect,
  imgW,
  imgH,
  cx,
  cy,
  zoom,
  viewportPx,
  onMoveViewport,

  threads,
  activeThreadId,
  validationLock,
  pendingStatusIds,
  onAddThreadMessage,
  onFocusThread,
  centerToThread,
  onToggleThreadStatus,
  onDeleteThread,
}: Props) {
  return (
    <div
      className={styles.sidebar}
      style={{ touchAction: "none" }}
      data-no-pin
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div data-no-pin>
        <Minimap
          src={src}
          imgW={imgW}
          imgH={imgH}
          cx={cx}
          cy={cy}
          zoom={zoom}
          viewportPx={viewportPx}
          onMoveViewport={onMoveViewport}
          miniAspect={miniAspect}
          // Minimap ya marca data-no-pin y corta propagación internamente
        />
      </div>

      <div
        className={styles.chatPanel}
        data-no-pin
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <ThreadsPanel
          threads={threads}
          activeThreadId={activeThreadId}
          validationLock={validationLock}
          pendingStatusIds={pendingStatusIds}
          composeLocked={false}
          statusLockedForActive={
            !!(
              pendingStatusIds &&
              activeThreadId &&
              pendingStatusIds.has(activeThreadId)
            )
          }
          onAddThreadMessage={onAddThreadMessage}
          onFocusThread={onFocusThread}
          centerToThread={centerToThread}
          onToggleThreadStatus={onToggleThreadStatus}
          onDeleteThread={onDeleteThread}
          emptyTitle="Aún no hay hilos en esta imagen"
          emptySubtitle="Haz click/tap en la imagen para crear un hilo y empezar el chat."
        />
      </div>
    </div>
  );
}
