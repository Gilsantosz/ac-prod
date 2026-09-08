import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { usePanelControls } from '@/components/dashboard/PanelControlsContext';

const GlassChartCard = forwardRef(function GlassChartCard(
  {
    title,
    subtitle,
    icon: Icon,
    badge,
    controls,
    children,
    className,
    headerClassName,
    contentClassName,
    actions,
    ...props
  },
  ref
) {
  const contextControls = usePanelControls();
  const activeControls = controls ?? contextControls;

  return (
    <section
      ref={ref}
      className={cn(
        'group/glass-card relative rounded-2xl p-5 sm:p-6',
        'bg-white/80 dark:bg-card/75 backdrop-blur-md',
        'border border-white/60 dark:border-white/10',
        'shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.25)]',
        'hover:shadow-[0_12px_36px_rgb(0,0,0,0.09)] dark:hover:shadow-[0_12px_36px_rgb(0,0,0,0.35)]',
        'transition-all duration-300',
        className
      )}
      {...props}
    >
      {(title || subtitle || activeControls || actions || badge) && (
        <header
          className={cn(
            'flex items-start justify-between gap-3 mb-5',
            headerClassName
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
              {title && (
                <h3 className="font-semibold text-base text-foreground tracking-tight">
                  {title}
                </h3>
              )}
              {badge}
            </div>
            {subtitle && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {actions}
            {activeControls}
          </div>
        </header>
      )}

      <div className={cn('min-w-0', contentClassName)}>
        {children}
      </div>
    </section>
  );
});

export default GlassChartCard;
