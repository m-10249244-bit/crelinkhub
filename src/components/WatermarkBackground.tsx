export function WatermarkBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none select-none z-0 overflow-hidden"
      aria-hidden="true"
    >
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern
            id="cre-watermark-pattern"
            width="360"
            height="240"
            patternUnits="userSpaceOnUse"
          >
            <image
              href="/assets/aistudio/Brown_and_Yellow_Cute_and_Fun_Photo_Studio_Logo_7949798d.jpg"
              x="16"
              y="10"
              width="168"
              height="168"
              transform="rotate(-20 100 94)"
              style={{
                filter: 'grayscale(100%) contrast(1.15)',
                opacity: 0.14,
                mixBlendMode: 'multiply',
              }}
            />
            <image
              href="/assets/aistudio/Brown_and_Yellow_Cute_and_Fun_Photo_Studio_Logo_7949798d.jpg"
              x="196"
              y="112"
              width="168"
              height="168"
              transform="rotate(-16 280 196)"
              style={{
                filter: 'grayscale(100%) contrast(1.15)',
                opacity: 0.14,
                mixBlendMode: 'multiply',
              }}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cre-watermark-pattern)" />
      </svg>
    </div>
  );
}
