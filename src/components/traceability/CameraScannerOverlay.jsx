export default function CameraScannerOverlay({ feedback, message }) {
  const color = feedback?.status === 'approved'
    ? 'border-emerald-400'
    : ['wrong_step', 'wrong_cell'].includes(feedback?.status)
      ? 'border-amber-400'
      : feedback && feedback.success === false
        ? 'border-red-400'
        : 'border-white';

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className={`relative w-[76%] max-w-md aspect-[1.8/1] border-2 ${color} rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.32)] transition-colors`}>
        <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-[#fff200] animate-pulse" />
      </div>
      <p className="absolute bottom-4 left-4 right-4 text-center text-sm font-semibold text-white drop-shadow-md">
        {message || 'Aponte a câmera para a etiqueta da peça'}
      </p>
    </div>
  );
}
