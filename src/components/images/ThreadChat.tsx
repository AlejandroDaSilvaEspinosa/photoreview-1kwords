// ThreadChat.tsx (nuevo componente)

"use client";

import React, {useRef, useEffect,useState, useCallback} from "react";
import styles from "./ThreadChat.module.css";
import ReactMarkdown from "react-markdown";
import { Thread, ThreadMessage,ThreadStatus } from "@/types/review";
import { format } from "timeago.js";
import AutoGrowTextarea from "../AutoGrowTextarea"

type Props = {
  activeThread: Thread;
  threads: Thread[];
  isMine: (author?: string | null) => boolean;
  onAddThreadMessage: (threadId: number, text: string) => Promise<void> | void;
  onFocusThread:(threadId: number | null) => void
  onToggleThreadStatus: (threadId: number, next: ThreadStatus) => void;
  onDeleteThread: (id: number) => void;

};

export default function ThreadChat({ activeThread, threads,  isMine,  onAddThreadMessage,onFocusThread,onToggleThreadStatus, onDeleteThread }: Props) {
    // estado
    const [drafts, setDrafts] = useState<Record<number, string>>({});
    const nextStatus = (s: ThreadStatus): ThreadStatus =>
        s === "corrected" ? "reopened" : "corrected";
    const toggleLabel = (s: ThreadStatus) => (s === "corrected" ? "Reabrir hilo" : "Validar correcciones");
    const colorByNextStatus = (s: ThreadStatus) =>
        s === "corrected" ? "orange" : "green"
    const colorByStatus = (s: ThreadStatus) =>
        s === "corrected" ? "#0FA958" : s === "reopened" ? "#FFB000" : s === "deleted" ? "#666" : "#FF0040";
    const listRef = useRef<HTMLDivElement | null>(null);

    const setDraft = (threadId: number, value: string | ((prev: string) => string)) => {
        setDrafts(prev => ({
            ...prev,
            [threadId]:
            typeof value === "function" ? value(prev[threadId] ?? "") : value,
        }));
    };

    const getDraft = (threadId: number) => drafts[threadId] ?? "";
    const clearDraft = (threadId: number) => {
        setDrafts(prev => {
        const { [threadId]: _omit, ...rest } = prev;
        return rest; // elimina la clave para no crecer sin límite
        });
    };
    const handleSend = async () => {
        if(activeThread.id){
        const draft =  getDraft(activeThread?.id)
        if (!activeThread || !draft.trim()) return;
        clearDraft(activeThread.id)
        await onAddThreadMessage(activeThread.id, draft.trim());
        }
    };
    useEffect(() => {
    if (!activeThread) return;
        requestAnimationFrame(() => {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        });
    }, [activeThread?.messages, activeThread?.id]);

  
   return (
    <div
      className={styles.chatDock}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      
    >
      <div className={styles.chatHeader}>

        <span><span className={styles.dotMini} style={{ background: colorByStatus(activeThread.status) }} />Hilo #{threads.findIndex((x) => x.id === activeThread.id) + 1}</span>
        <button
         type="button"
         onClick={() => onFocusThread(null)}
         className={styles.closeThreadChatBtn}
         aria-label="Cerrar hilo"
         title="Cerrar hilo"
        >
                ×
        </button>
      </div>
      <div 
       ref={listRef}
       className={styles.chatList}>
        {activeThread.messages.map((m: ThreadMessage) => {
          const mine = isMine(m.createdByName);
          
          const sys =
            !!m.isSystem || (m.createdByName || "").toLowerCase() === "system";
          return (
            <div
              key={m.id}
              className={
                sys
                  ? `${styles.bubble} ${styles.system}`
                  : `${styles.bubble} ${mine ? styles.mine : styles.theirs}`
              }
            >
              <div lang="es" className={styles.bubbleText}>
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
              <div className={styles.bubbleMeta}>
                <span className={styles.author}>
                  {sys ? "Sistema" : mine? "Tú": m.createdByName || "Usuario"}
                </span>
                <span className={styles.timeago}>
                  {format(m.createdAt, "es")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.composer}>

        <AutoGrowTextarea               
            value={activeThread?.id ? getDraft(activeThread?.id):""}
            onChange={(v:string) => activeThread.id &&  setDraft(activeThread.id, v)}
            placeholder="Escribe un mensaje…"
            minRows={1}
            maxRows={5}
            growsUp
            onEnter={handleSend}                        
        />
        <button onClick={handleSend}>Enviar</button>
      </div>
      <div className={styles.changeStatusBtnWrapper}>
        <button 
          className={`${styles.changeStatusBtn} ${styles[`${colorByNextStatus(activeThread.status)}`]}`}
          onClick={() => onToggleThreadStatus(activeThread.id, nextStatus(activeThread.status))}
          title={toggleLabel(activeThread.status)}
          >

            {toggleLabel(activeThread.status)}
            </button>
            <button 
            title={"Borrar hilo"}
            className={`${styles.red} ${styles.deleteThreadBtn}` }
            onClick={() => onDeleteThread( activeThread.id)}
            >
                🗑
            </button>
        </div>
    </div>
  );
}
