# Checklist RFID futuro

- [ ] Validar um EPC simulado conhecido.
- [ ] Validar uma leitura em massa com EPCs únicos.
- [ ] Repetir EPC dentro da janela de debounce e confirmar um único evento.
- [ ] Ler EPC em célula errada e confirmar o bloqueio.
- [ ] Confirmar o `reader_id` gravado.
- [ ] Confirmar o `station_name` gravado.
- [ ] Validar baixa automática somente em estação autorizada.
- [ ] Ler tag desconhecida e validar alerta claro sem baixa produtiva.
- [ ] Testar leitor fixo (`rfid_fixed`) e portátil (`rfid_handheld`).
- [ ] Desconectar o gateway e confirmar que a tela permanece utilizável.

Registrar fabricante, modelo, firmware, gateway, antena e potência utilizada.
