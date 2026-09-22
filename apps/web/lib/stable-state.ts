// Los sondeos (cada 4 s) vuelven a leer datos que casi siempre no cambiaron.
// Guardar en el estado un arreglo u objeto nuevo pero idéntico obliga a React a
// volver a renderizar todo el panel (un único componente grande) sin que nada
// cambie en pantalla. Con este helper, el estado conserva la misma referencia
// cuando el contenido es igual y React descarta la actualización.
//
// Las respuestas de la API y los `map*` de la página producen JSON puro y con
// orden de claves estable; si el orden llegara a variar, la comparación dice
// "distinto" y el comportamiento es el de antes (se aplica la actualización).

/** Devuelve `previous` si `next` tiene el mismo contenido; en otro caso, `next`. */
export function keepIfEqual<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
