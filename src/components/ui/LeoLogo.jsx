import { useState } from 'react';
import { cn } from '@/lib/utils';
import { LEO_COMPANY_NAME, LEO_LOGO_URL } from '@/lib/brandAssets';

export default function LeoLogo({ size = 'sm', className }) {
  const [imageFailed, setImageFailed] = useState(false);
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
      aria-label={LEO_COMPANY_NAME}
    >
      {imageFailed ? (
        <span role="img" aria-label={LEO_COMPANY_NAME} className="text-[#ffed00] font-extrabold text-xs leading-none">Leo</span>
      ) : (
        <img
          src={LEO_LOGO_URL}
          alt={LEO_COMPANY_NAME}
          className="h-full w-full object-contain"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  );
}
