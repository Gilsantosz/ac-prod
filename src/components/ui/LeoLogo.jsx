import { cn } from '@/lib/utils';

export default function LeoLogo({ size = "sm", className }) {
  const isLarge = size === "lg";
  
  return (
    <div 
      className={cn(
        "bg-[#034423] border-2 border-white flex items-center justify-center shrink-0 select-none shadow-md overflow-hidden relative transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-95",
        isLarge ? "w-14 h-14 rounded-2xl" : "w-9 h-9 rounded-xl",
        className
      )}
    >
      {/* Efeito de brilho de luz superior esquerdo premium */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent pointer-events-none" />
      
      {/* Texto Leo com proteção contra tradução automática (notranslate e translate="no") */}
      <span 
        className="text-[#E7F80A] font-black text-center leading-none inline-block select-none notranslate"
        translate="no"
        style={{ 
          fontSize: isLarge ? '23px' : '14px', 
          letterSpacing: '-0.07em', 
          transform: 'skewX(-4deg)',
          fontFamily: '"Outfit", "Inter", "Arial Black", sans-serif',
          whiteSpace: 'nowrap',
          padding: '0 1px'
        }}
      >
        Leo
      </span>
    </div>
  );
}
