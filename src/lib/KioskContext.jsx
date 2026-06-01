import { createContext, useContext, useState } from 'react';

const KioskContext = createContext({ kiosk: false, setKiosk: () => {}, toggleKiosk: () => {} });

export function KioskProvider({ children }) {
  const [kiosk, setKiosk] = useState(false);
  const toggleKiosk = () => setKiosk((k) => !k);
  return (
    <KioskContext.Provider value={{ kiosk, setKiosk, toggleKiosk }}>
      {children}
    </KioskContext.Provider>
  );
}

export const useKiosk = () => useContext(KioskContext);