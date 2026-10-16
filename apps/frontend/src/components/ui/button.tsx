import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono font-semibold uppercase tracking-[0.12em] transition-[background,color,box-shadow,border-color] disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-amber text-amber-ink [clip-path:polygon(0_0,calc(100%-8px)_0,100%_8px,100%_100%,8px_100%,0_calc(100%-8px))] hover:bg-fg hover:shadow-glow",
        ghost: "border border-line-strong bg-transparent text-fg hover:border-amber hover:text-amber",
        danger: "border border-alert/60 bg-transparent text-alert hover:bg-alert hover:text-bg",
        quiet: "bg-transparent text-dim hover:text-amber",
      },
      size: {
        sm: "h-8 px-3 text-[11px]",
        md: "h-10 px-5 text-xs",
        lg: "h-12 px-7 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Styles = VariantProps<typeof buttonStyles>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & Styles) {
  return <button type={type} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof Link> & Styles) {
  return <Link className={cn(buttonStyles({ variant, size }), "no-underline hover:no-underline", className)} {...props} />;
}
