import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-bold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-bg hover:opacity-85",
        secondary: "border-[1.5px] border-line-strong text-ink hover:border-ink-soft",
        ghost: "text-ink-soft hover:bg-surface-2 hover:text-ink",
        brand: "bg-brand text-white hover:brightness-110",
        urgent: "bg-urgent text-white hover:brightness-110",
      },
      size: {
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-5 text-base",
        sm: "h-9 px-3 text-sm",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
