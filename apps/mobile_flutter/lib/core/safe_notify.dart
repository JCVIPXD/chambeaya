import 'package:flutter/scheduler.dart';

/// Ejecuta [notify] ya, o al terminar el cuadro actual si el árbol se está
/// construyendo. Un controlador que se carga desde `initState` notifica a sus
/// oyentes mientras otro widget construye; `setState` en esa fase falla.
void notifyOutsideBuild(VoidCallback notify) {
  final binding = SchedulerBinding.instance;
  if (binding.schedulerPhase == SchedulerPhase.persistentCallbacks) {
    binding.addPostFrameCallback((_) => notify());
  } else {
    notify();
  }
}
