/** 转录覆盖分布条
 *
 * 将音频等分为若干段，每段用一个彩色小格子表示：
 * - 紫色（bg-violet-500）：该时间段内有转录内容（有人声）
 * - 灰色（bg-gray-200 dark:bg-gray-700）：该时间段无转录内容（静音）
 *
 * 设计为紧凑水平条，只占用少量垂直空间，适合在文件列表行内展示。
 */

interface CoverageBarProps {
  coverage: boolean[];
  className?: string;
}

export function CoverageBar({ coverage, className = "" }: CoverageBarProps) {
  if (!coverage || coverage.length === 0) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-px ${className}`}
      title={buildTooltip(coverage)}
    >
      {coverage.map((hasContent, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-[1px] transition-colors ${
            hasContent
              ? "bg-violet-500/70"
              : "bg-gray-200 dark:bg-gray-700/70"
          }`}
        />
      ))}
    </span>
  );
}

function buildTooltip(coverage: boolean[]): string {
  const transcribed = coverage.filter(Boolean).length;
  const total = coverage.length;
  const pct = Math.round((transcribed / total) * 100);
  return `转录覆盖: ${pct}%（${transcribed}/${total} 段有人声）`;
}
