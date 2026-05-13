import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import type { RelocateResult } from "@/lib/types";

interface RelocateDialogProps {
  result: RelocateResult;
  onConfirm: () => void;
  onClose: () => void;
}

export function RelocateDialog({ result, onConfirm, onClose }: RelocateDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const { matched, unmatched } = result;
  const total = matched.length + unmatched.length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        ref={panelRef}
        className="flex max-h-[80vh] w-[520px] flex-col rounded-xl border border-border bg-surface shadow-2xl"
      >
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">路径配准结果</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-secondary"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 统计 */}
        <div className="flex gap-4 border-b border-border px-5 py-3">
          <span className="text-sm">
            共 <strong>{total}</strong> 个缺失文件
          </span>
          <span className="text-sm text-green-600">
            已匹配 <strong>{matched.length}</strong>
          </span>
          {unmatched.length > 0 && (
            <span className="text-sm text-amber-600">
              未匹配 <strong>{unmatched.length}</strong>
            </span>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {matched.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-medium text-text-secondary">已匹配</h3>
              <div className="flex flex-col gap-2">
                {matched.map((m) => (
                  <div key={m.id} className="rounded-lg border border-green-200 bg-green-50 p-2.5 dark:border-green-900 dark:bg-green-950/30">
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="mt-1 truncate text-xs text-text-secondary" title={m.oldPath}>
                      {m.oldPath}
                    </p>
                    <div className="my-0.5 flex items-center text-xs text-green-600">
                      <svg className="mr-1 size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </div>
                    <p className="truncate text-xs text-green-700 dark:text-green-400" title={m.newPath}>
                      {m.newPath}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-text-secondary">未匹配</h3>
              <div className="flex flex-col gap-2">
                {unmatched.map((u) => (
                  <div key={u.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="mt-1 truncate text-xs text-text-secondary" title={u.path}>
                      {u.path}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {total === 0 && (
            <p className="py-4 text-center text-sm text-text-secondary">
              该文件夹下没有缺失的文件
            </p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-sm transition-colors hover:bg-surface-secondary"
          >
            关闭
          </button>
          {matched.length > 0 && (
            <button
              onClick={onConfirm}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white transition-colors hover:bg-primary-hover"
            >
              确认并刷新
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
