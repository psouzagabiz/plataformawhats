import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "ghost-light" | "ghost-dark";

export function buttonClasses(variant: Variant = "primary", className?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-[0.95rem] font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
    variant === "primary" && "bg-candle text-vesper-deep hover:bg-candle-soft",
    variant === "ghost-light" &&
      "border border-parchment-line text-ink hover:bg-parchment-card",
    variant === "ghost-dark" && "border border-white/20 text-parchment hover:bg-white/5",
    className
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = "primary", ...props }, ref) {
  return <button ref={ref} className={buttonClasses(variant, className)} {...props} />;
});
