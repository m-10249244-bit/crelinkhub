interface StickerHeadingProps {
  text: string;
  as?: 'h1' | 'h2';
  size?: 'lg' | 'md';
  className?: string;
}

export function StickerHeading({
  text,
  as = 'h2',
  size = 'md',
  className = '',
}: StickerHeadingProps) {
  const Tag = as;
  const strokeClass = size === 'lg' ? 'sticker-text' : 'sticker-text-sm';
  const sizeClass =
    size === 'lg'
      ? 'text-[30px] sm:text-[38px] md:text-[44px] leading-none'
      : 'text-[22px] sm:text-[26px] leading-none';

  return (
    <Tag
      className={`relative inline-block font-bold select-none ${sizeClass} ${className}`}
    >
      <span className={`${strokeClass} block`}>{text}</span>
    </Tag>
  );
}
