import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out enabled:active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Главное действие экрана — акцентный цвет (решение 028).
        primary:
          "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:brightness-110",
        // Тёмная — сильное, но нейтральное действие (сохранить, применить).
        dark: "bg-ink text-bg hover:opacity-90",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        // Мягкие цветные — дополнительные действия, у каждого свой смысл.
        soft: "bg-accent/12 text-accent hover:bg-accent/20",
        success: "bg-ok/12 text-ok hover:bg-ok/20",
        danger: "bg-urgent/10 text-urgent hover:bg-urgent/18",
        ghost: "text-ink-soft hover:bg-surface-2 hover:text-ink",
        brand: "bg-brand text-white hover:brightness-110",
        urgent: "bg-urgent text-white hover:brightness-110",
      },
      size: {
        // Телефон — не меньше 40–44 px по высоте, компьютер — плотнее (решение 024).
        md: "h-10 px-3.5 text-[13.5px] lg:h-9",
        lg: "h-11 px-4 text-sm lg:h-10",
        sm: "h-9 px-2.5 text-[13px] lg:h-8",
        icon: "size-10 lg:size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
