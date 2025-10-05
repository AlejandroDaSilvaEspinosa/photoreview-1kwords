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
    <div className={styles.sidebar} style={{ touchAction: "none" }}>
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
      />

      <div className={styles.chatPanel}>
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
