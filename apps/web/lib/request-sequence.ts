// Secuenciación de lecturas repetidas (sondeo) para que una respuesta que llega
// tarde no pise a una más reciente ni a una escritura ya confirmada.
//
// Cada lectura pide un número con `issue()` al emitirse. Al llegar la respuesta,
// `accept()` decide si todavía vale:
//
// - se descarta si una respuesta más nueva ya se aplicó (llegó desordenada), y
// - se descarta si se emitió antes de la última escritura confirmada
//   (`invalidateInFlight()`): el servidor pudo leer el estado previo a la
//   escritura, así que su cuerpo ya está obsoleto aunque llegue después.
//
// Una respuesta lenta pero más nueva que la última aplicada sí se acepta, así un
// servidor lento no deja al sondeo sin aplicar nada.

export type RequestSequence = {
  issued: number;
  applied: number;
  floor: number;
};

export function createRequestSequence(): RequestSequence {
  return { issued: 0, applied: 0, floor: 0 };
}

/** Registra una lectura recién emitida y devuelve su número. */
export function issueRequest(sequence: RequestSequence): number {
  sequence.issued += 1;
  return sequence.issued;
}

/**
 * Marca como obsoletas todas las lecturas emitidas hasta ahora. Se llama cuando
 * una escritura se confirma, antes de emitir la lectura que la refleja.
 */
export function invalidateInFlight(sequence: RequestSequence): void {
  sequence.floor = sequence.issued + 1;
}

/**
 * `true` si la respuesta de la lectura `request` puede aplicarse; en ese caso la
 * registra como la más reciente aplicada. `false` si es obsoleta y hay que
 * ignorarla.
 */
export function acceptResponse(
  sequence: RequestSequence,
  request: number,
): boolean {
  if (request < sequence.floor || request <= sequence.applied) return false;
  sequence.applied = request;
  return true;
}
