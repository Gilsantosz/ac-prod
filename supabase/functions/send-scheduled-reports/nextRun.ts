function calculateNextRun(frequency: string, timeLocal: string) {
  const [hours, minutes] = timeLocal.split(':').map(Number);
  const now = new Date();
  
  const getBrasiliaDate = (date: Date) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value);
    return new Date(Date.UTC(getPart("year"), getPart("month") - 1, getPart("day"), getPart("hour"), getPart("minute"), getPart("second")));
  };

  const brDate = getBrasiliaDate(now);
  
  let targetLocal = new Date(brDate);
  targetLocal.setUTCHours(hours, minutes, 0, 0);
  
  const isPast = targetLocal.getTime() <= brDate.getTime();
  
  if (isPast) {
    if (frequency === 'daily') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    } else if (frequency === 'workdays') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      while (targetLocal.getUTCDay() === 0 || targetLocal.getUTCDay() === 6) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      }
    } else if (frequency === 'weekly') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 7);
    } else if (frequency === 'monthly') {
      targetLocal.setUTCMonth(targetLocal.getUTCMonth() + 1);
    }
  } else {
    if (frequency === 'workdays') {
      while (targetLocal.getUTCDay() === 0 || targetLocal.getUTCDay() === 6) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      }
    }
  }
  
  const offset = brDate.getTime() - now.getTime();
  const targetUTC = new Date(targetLocal.getTime() - offset);
  return targetUTC;
}
export { calculateNextRun };
