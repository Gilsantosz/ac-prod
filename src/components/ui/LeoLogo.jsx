import { useState } from 'react';
import { cn } from '@/lib/utils';
import { LEO_LOGO_DATA_URL } from '@/lib/brandLogo';

export default function LeoLogo({ size = 'sm', className }) {
  const [failed, setFailed] = useState(false);
  const sizeClass = {
    sm: 'w-9 h-9 rounded-xl',
    md: 'w-11 h-11 rounded-2xl',
    lg: 'w-14 h-14 rounded-2xl',
  }[size] || 'w-9 h-9 rounded-xl';
  return (
    <div
      className={cn(
        'bg-[#00522d] border-2 border-white flex items-center justify-center shrink-0 select-none shadow-md overflow-hidden relative transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-95',
        sizeClass, className,
      )}
      aria-label="Leo Madeiras"
    >
      {failed ? (
        <span role="img" aria-label="Leo Madeiras" className="text-[#ffed00] text-sm font-black">Leo</span>
      ) : (
        <img src={LEO_LOGO_DATA_URL} alt="Leo Madeiras" className="h-full w-full object-contain"
          draggable={false} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
