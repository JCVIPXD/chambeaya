import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

/// Guarda un PDF ya validado. Devuelve `true` si el usuario eligió dónde
/// guardarlo y `false` si canceló. Se inyecta en las pantallas para poder
/// simularlo en las pruebas.
typedef PdfSaver = Future<bool> Function(String fileName, Uint8List bytes);

/// Descarga segura: el archivo nunca se abre ni se ejecuta desde la app; el
/// sistema abre su propio cuadro "Guardar como" y el usuario decide el destino.
/// El nombre ya viene saneado (ver `safePdfFileName`).
Future<bool> savePdfWithPicker(String fileName, Uint8List bytes) async {
  final saved = await FilePicker.saveFile(
    fileName: fileName,
    bytes: bytes,
    mimeType: 'application/pdf',
    type: FileType.custom,
    allowedExtensions: const ['pdf'],
  );
  return saved != null;
}
