interface SidebarItemProps {
  label: string;
  active?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export function SidebarItem({
  label,
  active = false,
  icon,
  onClick,
}: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-text-secondary hover:bg-border/50 hover:text-text"
      }`}
    >
      {icon && <span className="size-4">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}
