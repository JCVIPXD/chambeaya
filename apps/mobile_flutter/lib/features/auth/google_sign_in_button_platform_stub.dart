import 'package:flutter/material.dart';

Widget buildGoogleButton({required VoidCallback onPressed}) =>
    OutlinedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.login_rounded),
      label: const Text('Continuar con Google'),
    );
