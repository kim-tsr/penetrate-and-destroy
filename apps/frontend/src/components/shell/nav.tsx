"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  /** Texte court affiché dans la pastille numérotée. */
  code: string;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/manage") return pathname === "/manage";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavList({ title, items }: { title: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={title} className="space-y-1">
      <p className="label px-3 pb-1 pt-3">{title}</p>
      <ul className="space-y-px">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 border-l-2 px-3 py-1.5 text-[13px] uppercase tracking-[0.1em] no-underline transition-colors hover:no-underline",
                  active
                    ? "border-amber bg-amber/10 text-amber"
                    : "border-transparent text-dim hover:border-line-strong hover:bg-panel hover:text-fg",
                )}
              >
                <span className={cn("tabular w-5 text-[10px]", active ? "text-amber" : "text-muted")}>{item.code}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
