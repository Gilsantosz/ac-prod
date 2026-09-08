import { createContext, useContext } from 'react';

export const PanelControlsContext = createContext(null);

export function usePanelControls() {
  return useContext(PanelControlsContext);
}
