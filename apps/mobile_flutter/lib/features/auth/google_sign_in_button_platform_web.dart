import 'package:flutter/widgets.dart';
import 'package:google_sign_in_web/web_only.dart' as google_web;

Widget buildGoogleButton({required VoidCallback onPressed}) => SizedBox(
  width: 280,
  height: 40,
  child: google_web.renderButton(
    configuration: google_web.GSIButtonConfiguration(
      text: google_web.GSIButtonText.continueWith,
      theme: google_web.GSIButtonTheme.outline,
      size: google_web.GSIButtonSize.large,
      minimumWidth: 280,
      locale: 'es',
    ),
  ),
);
