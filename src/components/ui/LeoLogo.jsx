import { cn } from '@/lib/utils';
import leoLogoUrl from '@/assets/leo-madeiras-logo.jpg';

export default function LeoLogo({ size = "sm", className }) {
  const sizeClass = {
    sm: 'w-9 h-9 rounded-xl',
    md: 'w-11 h-11 rounded-2xl',
    lg: 'w-14 h-14 rounded-2xl',
  }[size] || 'w-9 h-9 rounded-xl';
  
  return (
    <div
      className={cn(
        'bg-[#00522d] border-2 border-white flex items-center justify-center shrink-0 select-none shadow-md overflow-hidden relative transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-95',
        sizeClass,
        className
      )}
      aria-label="Leo Madeiras"
    >
      <img
        src={leoLogoUrl}
        alt="Leo Madeiras"
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}
