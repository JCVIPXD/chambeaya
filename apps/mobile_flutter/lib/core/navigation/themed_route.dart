import 'package:flutter/material.dart';

/// Abre una pantalla encima de la actual conservando el tema del contexto.
///
/// El modo oscuro del trabajador vive en un `Theme` local dentro de
/// `WorkerShell`; una `MaterialPageRoute` normal se monta en el `Navigator`
/// raíz, que queda fuera de ese `Theme` y se vería con el tema claro del
/// `MaterialApp`. Aquí se captura el tema del contexto y se reaplica a la ruta
/// (igual que hacen `showDialog` y `showModalBottomSheet`), sin cambiar la
/// pila de navegación: el botón «atrás» y los gestos siguen igual.
Future<T?> pushThemed<T>(BuildContext context, WidgetBuilder builder) {
  final navigator = Navigator.of(context);
  final themes = InheritedTheme.capture(from: context, to: navigator.context);
  return navigator.push<T>(
    MaterialPageRoute<T>(builder: (routeContext) => themes.wrap(builder(routeContext))),
  );
}
