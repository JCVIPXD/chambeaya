import 'dart:math' as math;

import 'package:chambeaya_mobile/features/discovery/widgets/job_search_bar.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:chambeaya_mobile/theme/theme_mode_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Regression tests for the dark-mode contrast of the worker's search and
// filter controls (CN-20260921-009). Reported symptom: "los campos de filtro
// de busqueda de la interfaz del trabajador son blancos con letras casi
// imperceptibles en modo oscuro". The cause was `_FilterDropdown`
// (`job_filter_controls.dart`): its container was painted with a hardcoded
// `Colors.white` while the selected value took `textTheme.titleMedium` (the
// palette's near-white `ink` in dark) and the arrow took Flutter's own
// `Colors.white70`, i.e. near-white on white (~1.1:1).
//
// The tests mount the real `WorkerShell` under the real dark/light theme,
// read the *effective* colors out of the widget tree (fill, typed text, hint,
// icons, borders) and compute the WCAG 2.x contrast ratio between each
// foreground and the surface it is really painted on. Nothing here hardcodes
// the expected colors of the dark theme: only ratios, so a legitimate palette
// tweak does not break them, while a fixed white background or a light
// palette leaking into the dark theme does.

/// WCAG 2.x relative luminance of an opaque sRGB color.
double _luminance(Color color) {
  double channel(double value) => value <= 0.03928
      ? value / 12.92
      : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(color.r) +
      0.7152 * channel(color.g) +
      0.0722 * channel(color.b);
}

/// WCAG contrast ratio between two opaque colors.
double _ratio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// Source-over blend of a possibly translucent [foreground] on [background].
Color _over(Color foreground, Color background) {
  final alpha = foreground.a;
  return Color.from(
    alpha: 1,
    red: foreground.r * alpha + background.r * (1 - alpha),
    green: foreground.g * alpha + background.g * (1 - alpha),
    blue: foreground.b * alpha + background.b * (1 - alpha),
  );
}

String _hex(Color color) =>
    '#${color.toARGB32().toRadixString(16).padLeft(8, '0').toUpperCase()}';

/// The opaque color actually painted behind [finder]: walks up the ancestors
/// to the closest opaque fill (a `DecoratedBox`/`ColoredBox`, a `Material`
/// with a color, or a filled `InputDecorator`) and blends any translucent
/// layers found on the way over it.
Color _backgroundBehind(WidgetTester tester, Finder finder) {
  final translucent = <Color>[];
  Color? base;
  tester.element(finder.first).visitAncestorElements((ancestor) {
    final widget = ancestor.widget;
    Color? fill;
    if (widget is DecoratedBox && widget.decoration is BoxDecoration) {
      fill = (widget.decoration as BoxDecoration).color;
    } else if (widget is ColoredBox) {
      fill = widget.color;
    } else if (widget is Ink) {
      // Chips paint their fill with an `Ink` decoration.
      final decoration = widget.decoration;
      if (decoration is ShapeDecoration) fill = decoration.color;
      if (decoration is BoxDecoration) fill = decoration.color;
    } else if (widget is Material && widget.type != MaterialType.transparency) {
      fill =
          widget.color ??
          (widget.type == MaterialType.canvas
              ? Theme.of(ancestor).canvasColor
              : null);
    } else if (widget is InputDecorator && widget.decoration.filled == true) {
      fill = widget.decoration.fillColor;
    } else if (widget is CustomPaint && widget.painter != null) {
      // The open dropdown menu paints its surface with a private painter.
      try {
        fill = (widget.painter! as dynamic).color as Color?;
      } catch (_) {
        fill = null;
      }
    }
    if (fill == null || fill.a == 0) return true;
    if (fill.a < 1) {
      translucent.add(fill);
      return true;
    }
    base = fill;
    return false;
  });
  var color = base ?? (throw StateError('no opaque background behind $finder'));
  for (final layer in translucent.reversed) {
    color = _over(layer, color);
  }
  return color;
}

/// Effective color of a `Text` (its own style merged onto the inherited
/// `DefaultTextStyle`, exactly what `Text.build` does).
Color _textColor(WidgetTester tester, Finder finder) {
  final element = tester.element(finder.first);
  final text = element.widget as Text;
  final base = DefaultTextStyle.of(element).style;
  final style = text.style == null ? base : base.merge(text.style);
  return style.color ?? (throw StateError('no text color for $finder'));
}

/// Effective color of an `Icon` (own color or the inherited `IconTheme`),
/// including the theme's opacity.
Color _iconColor(WidgetTester tester, Finder finder) {
  final element = tester.element(finder.first);
  final icon = element.widget as Icon;
  final theme = IconTheme.of(element);
  final color = icon.color ?? theme.color;
  if (color == null) throw StateError('no icon color for $finder');
  return color.withValues(alpha: color.a * (theme.opacity ?? 1));
}

/// Border color of the closest ancestor that draws an outline around
/// [finder]: a `DecoratedBox` with a `Border`, a `Material` with an
/// `OutlinedBorder` shape/side (chips) or an `InputDecorator`.
Color _borderBehind(WidgetTester tester, Finder finder) {
  Color? result;
  tester.element(finder.first).visitAncestorElements((ancestor) {
    final widget = ancestor.widget;
    if (widget is DecoratedBox && widget.decoration is BoxDecoration) {
      final border = (widget.decoration as BoxDecoration).border;
      if (border is Border) {
        result = border.top.color;
        return false;
      }
    } else if (widget is Ink && widget.decoration is ShapeDecoration) {
      final shape = (widget.decoration! as ShapeDecoration).shape;
      if (shape is OutlinedBorder && shape.side != BorderSide.none) {
        result = shape.side.color;
        return false;
      }
    } else if (widget is Material && widget.shape is OutlinedBorder) {
      final side = (widget.shape! as OutlinedBorder).side;
      if (side != BorderSide.none) {
        result = side.color;
        return false;
      }
    } else if (widget is InputDecorator) {
      final border =
          widget.decoration.enabledBorder ?? widget.decoration.border;
      if (border is OutlineInputBorder) {
        result = border.borderSide.color;
        return false;
      }
    }
    return true;
  });
  return result ?? (throw StateError('no border around $finder'));
}

class _NoopStore implements ThemeModeStore {
  @override
  Future<ThemeMode> read() async => ThemeMode.light;
  @override
  Future<void> write(ThemeMode mode) async {}
}

Future<void> _pumpShell(WidgetTester tester, {required bool dark}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(Brightness.light),
      home: WorkerShell(
        repository: DemoWorkerMarketplaceRepository(),
        themeModeController: ThemeModeController(
          store: _NoopStore(),
          initial: dark ? ThemeMode.dark : ThemeMode.light,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openFilterSheet(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Filtros'));
  await tester.pumpAndSettle();
}

/// Every dropdown in the filter sheet, in display order.
Finder get _dropdowns =>
    find.byWidgetPredicate((widget) => widget is DropdownButton);

Text _selectedLabel(DropdownButton<dynamic> dropdown) =>
    dropdown.items!.firstWhere((item) => item.value == dropdown.value).child
        as Text;

const _textMinimum = 4.5;
const _graphicMinimum = 3.0;

// Light mode must not change (it keeps its brand colors exactly), and two of
// its pre-existing values sit below the AA targets: the muted hint/label
// (#718096 on #F4F7FB, 3.74:1) and the hairline border of fields and chips
// (#D9E2EC on white, 1.3:1). They are guarded here as "not worse than today"
// instead of being raised; see the CN-20260921-009 entry.
const _lightHintFloor = 3.7;
const _lightBorderFloor = 1.2;
// Muted text on the amber error notice, light mode (#718096 on #FFF4E5).
const _lightNoticeFloor = 3.6;

void _log(String message) {
  // ignore: avoid_print
  print('CONTRASTE $message');
}

/// Measures one foreground on the surface behind it and records it.
double _measure(String name, Color foreground, Color background) {
  final visible = _over(foreground, background);
  final ratio = _ratio(visible, background);
  _log(
    '$name: ${ratio.toStringAsFixed(2)}:1 '
    '(fg=${_hex(foreground)} bg=${_hex(background)})',
  );
  return ratio;
}

class _FailingSaveRepository extends DemoWorkerMarketplaceRepository {
  @override
  Future<void> toggleSavedShift(String shiftId) async =>
      throw Exception('offline');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final dark in [true, false]) {
    final mode = dark ? 'oscuro' : 'claro';

    group('filtros y busqueda del trabajador en modo $mode', () {
      testWidgets('el campo de busqueda: texto escrito, hint e icono', (
        tester,
      ) async {
        await _pumpShell(tester, dark: dark);
        final field = find.descendant(
          of: find.byType(JobSearchBar),
          matching: find.byType(TextField),
        );
        await tester.enterText(field, 'Mozo');
        await tester.pump();

        final editableFinder = find.descendant(
          of: field,
          matching: find.byType(EditableText),
        );
        final fill = _backgroundBehind(tester, editableFinder);
        final editable = tester.widget<EditableText>(editableFinder);
        final typed = _measure(
          'busqueda/$mode texto escrito',
          editable.style.color!,
          fill,
        );
        expect(typed, greaterThanOrEqualTo(_textMinimum));

        // Hint: clear the field so it is visible again.
        await tester.enterText(field, '');
        await tester.pump();
        final hint = find.text('Cargo, empresa o distrito');
        final hintRatio = _measure(
          'busqueda/$mode hint',
          _textColor(tester, hint),
          fill,
        );
        expect(
          hintRatio,
          greaterThanOrEqualTo(dark ? _textMinimum : _lightHintFloor),
        );

        final iconRatio = _measure(
          'busqueda/$mode icono de lupa',
          _iconColor(tester, find.byIcon(Icons.search_rounded)),
          fill,
        );
        expect(iconRatio, greaterThanOrEqualTo(_graphicMinimum));

        final borderRatio = _measure(
          'busqueda/$mode borde',
          _borderBehind(tester, editableFinder),
          fill,
        );
        expect(
          borderRatio,
          greaterThanOrEqualTo(dark ? _graphicMinimum : _lightBorderFloor),
          reason: 'borde del campo de busqueda imperceptible',
        );
      });

      testWidgets('el boton de filtros de la barra de busqueda', (
        tester,
      ) async {
        await _pumpShell(tester, dark: dark);
        final icon = find.descendant(
          of: find.byTooltip('Filtros'),
          matching: find.byIcon(Icons.tune_rounded),
        );
        final ratio = _measure(
          'boton Filtros/$mode icono',
          _iconColor(tester, icon),
          _backgroundBehind(tester, icon),
        );
        expect(ratio, greaterThanOrEqualTo(_graphicMinimum));
      });

      testWidgets('los chips Recomendados/Urgentes, sin marcar y marcados', (
        tester,
      ) async {
        await _pumpShell(tester, dark: dark);
        final urgent = find.widgetWithText(FilterChip, 'Urgentes');
        final label = find.descendant(
          of: urgent,
          matching: find.text('Urgentes'),
        );

        final off = _measure(
          'chip Urgentes/$mode sin marcar',
          _textColor(tester, label),
          _backgroundBehind(tester, label),
        );
        expect(off, greaterThanOrEqualTo(_textMinimum));
        final offBorder = _measure(
          'chip Urgentes/$mode sin marcar borde',
          _borderBehind(tester, label),
          _backgroundBehind(tester, label),
        );
        expect(
          offBorder,
          greaterThanOrEqualTo(dark ? _graphicMinimum : _lightBorderFloor),
          reason: 'borde del chip imperceptible',
        );

        await tester.tap(urgent);
        await tester.pumpAndSettle();
        final on = _measure(
          'chip Urgentes/$mode marcado',
          _textColor(tester, label),
          _backgroundBehind(tester, label),
        );
        expect(on, greaterThanOrEqualTo(_textMinimum));
      });

      testWidgets('los seis desplegables de la hoja de filtros', (
        tester,
      ) async {
        await _pumpShell(tester, dark: dark);
        await _openFilterSheet(tester);

        final count = _dropdowns.evaluate().length;
        expect(
          count,
          6,
          reason: 'Rubro, Pago, Distrito, Modalidad, Fecha, Orden',
        );
        final problems = <String>[];
        for (var i = 0; i < count; i++) {
          final dropdown = _dropdowns.at(i);
          final widget = tester.widget<DropdownButton<dynamic>>(dropdown);
          final selected = _selectedLabel(widget);
          final labelFinder = find.descendant(
            of: dropdown,
            matching: find.text(selected.data!),
          );
          final name = 'desplegable "${selected.data}"/$mode';
          final background = _backgroundBehind(tester, labelFinder);

          void check(String part, double ratio, double minimum) {
            if (ratio < minimum) {
              problems.add(
                '$name $part: ${ratio.toStringAsFixed(2)}:1 < $minimum:1',
              );
            }
          }

          check(
            'texto',
            _measure(
              '$name texto',
              _textColor(tester, labelFinder),
              background,
            ),
            _textMinimum,
          );
          check(
            'flecha',
            _measure(
              '$name flecha',
              _iconColor(
                tester,
                find.descendant(
                  of: dropdown,
                  matching: find.byIcon(Icons.arrow_drop_down),
                ),
              ),
              background,
            ),
            _graphicMinimum,
          );
          check(
            'borde',
            _measure(
              '$name borde',
              _borderBehind(tester, labelFinder),
              background,
            ),
            dark ? _graphicMinimum : _lightBorderFloor,
          );
        }
        expect(problems, isEmpty, reason: 'desplegables de filtro ilegibles');
      });

      testWidgets('las opciones del desplegable abierto', (tester) async {
        await _pumpShell(tester, dark: dark);
        await _openFilterSheet(tester);

        // "Orden" is the last dropdown: open it and read one of its options.
        await tester.tap(_dropdowns.last);
        await tester.pumpAndSettle();
        final option = find.text('Mayor pago').last;
        final background = _backgroundBehind(tester, option);
        final ratio = _measure(
          'opcion "Mayor pago"/$mode',
          _textColor(tester, option),
          background,
        );
        expect(ratio, greaterThanOrEqualTo(_textMinimum));
      });

      testWidgets('el aviso de error que aparece bajo los filtros', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(Brightness.light),
            home: WorkerShell(
              repository: _FailingSaveRepository(),
              themeModeController: ThemeModeController(
                store: _NoopStore(),
                initial: dark ? ThemeMode.dark : ThemeMode.light,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Guardar empleo').first);
        await tester.pumpAndSettle();

        final message = find.text(
          'No pudimos guardar el empleo. Inténtalo otra vez.',
        );
        expect(message, findsOneWidget);
        final background = _backgroundBehind(tester, message);
        expect(background, const Color(0xFFFFF4E5));
        if (!dark) {
          // Light keeps the inherited muted text on the amber fill.
          expect(_textColor(tester, message), AppColors.muted);
          expect(tester.widget<Text>(message).style?.fontSize ?? 13, 13);
        }
        expect(
          _measure(
            'aviso de error/$mode texto',
            _textColor(tester, message),
            background,
          ),
          greaterThanOrEqualTo(dark ? _textMinimum : _lightNoticeFloor),
        );
        expect(
          _measure(
            'aviso de error/$mode icono',
            _iconColor(tester, find.byIcon(Icons.info_outline_rounded)),
            background,
          ),
          greaterThanOrEqualTo(_graphicMinimum),
        );
      });

      testWidgets('el titulo y los controles de la hoja de filtros', (
        tester,
      ) async {
        await _pumpShell(tester, dark: dark);
        await _openFilterSheet(tester);
        final title = find.text('Filtros de búsqueda');
        final ratio = _measure(
          'titulo de la hoja/$mode',
          _textColor(tester, title),
          _backgroundBehind(tester, title),
        );
        expect(ratio, greaterThanOrEqualTo(_textMinimum));
      });
    });

    // Other worker screens (profile editor, messages composer, screening
    // dialog) do not override the input style: they inherit
    // `inputDecorationTheme`/`chipTheme` from the theme. Checking the theme
    // itself with the widgets they use covers all of them.
    testWidgets('campos y chips heredados del tema en modo $mode', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(dark ? Brightness.dark : Brightness.light),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const TextField(
                    decoration: InputDecoration(
                      labelText: 'Distrito',
                      hintText: 'Escribe tu distrito',
                      prefixIcon: Icon(Icons.place_outlined),
                    ),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: 'A',
                    decoration: const InputDecoration(labelText: 'Nivel'),
                    items: const [
                      DropdownMenuItem(value: 'A', child: Text('Básico')),
                    ],
                    onChanged: (_) {},
                  ),
                  FilterChip(
                    label: const Text('Lunes'),
                    selected: false,
                    onSelected: (_) {},
                  ),
                  FilterChip(
                    label: const Text('Martes'),
                    selected: true,
                    onSelected: (_) {},
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final field = find.byType(TextField);
      final fill = _backgroundBehind(
        tester,
        find.descendant(of: field, matching: find.byType(EditableText)),
      );
      final hint = tester.widget<Text>(find.text('Escribe tu distrito'));
      // The hint is only painted while the label is not floating over it, so
      // measure its effective style from the decoration instead.
      final decoration = tester.widget<InputDecorator>(
        find.descendant(of: field, matching: find.byType(InputDecorator)),
      );
      expect(
        _measure(
          'tema/$mode hint de TextField',
          (hint.style ?? decoration.decoration.hintStyle)!.color!,
          fill,
        ),
        greaterThanOrEqualTo(dark ? _textMinimum : _lightHintFloor),
      );
      expect(
        _measure(
          'tema/$mode etiqueta de TextField',
          decoration.decoration.labelStyle!.color!,
          fill,
        ),
        greaterThanOrEqualTo(dark ? _textMinimum : _lightHintFloor),
      );
      expect(
        _measure(
          'tema/$mode icono de TextField',
          _iconColor(tester, find.byIcon(Icons.place_outlined)),
          fill,
        ),
        greaterThanOrEqualTo(_graphicMinimum),
      );
      expect(
        _measure(
          'tema/$mode borde de TextField',
          _borderBehind(tester, find.text('Distrito')),
          fill,
        ),
        greaterThanOrEqualTo(dark ? _graphicMinimum : _lightBorderFloor),
        reason: 'borde del campo imperceptible sobre su relleno',
      );

      final selectValue = find.descendant(
        of: find.byType(DropdownButtonFormField<String>),
        matching: find.text('Básico'),
      );
      expect(
        _measure(
          'tema/$mode valor de DropdownButtonFormField',
          _textColor(tester, selectValue),
          _backgroundBehind(tester, selectValue),
        ),
        greaterThanOrEqualTo(_textMinimum),
      );

      for (final chip in ['Lunes', 'Martes']) {
        final label = find.text(chip);
        expect(
          _measure(
            'tema/$mode chip $chip',
            _textColor(tester, label),
            _backgroundBehind(tester, label),
          ),
          greaterThanOrEqualTo(_textMinimum),
        );
      }
    });
  }

  // Focus must stay visible in dark mode: the focused outline (teal, 2 px)
  // has to stand out from the field's own fill.
  test('modo oscuro: el borde de foco de los campos se distingue', () {
    final theme = buildAppTheme(Brightness.dark);
    final focused =
        theme.inputDecorationTheme.focusedBorder as OutlineInputBorder;
    final ratio = _measure(
      'foco de campo/oscuro',
      focused.borderSide.color,
      AppPalette.dark.surface,
    );
    expect(ratio, greaterThanOrEqualTo(_graphicMinimum));
    expect(focused.borderSide.width, 2);
  });

  // The light mode must look exactly like before the fix: these are the
  // literal colors the light filter controls have always had.
  testWidgets('modo claro: los colores de los controles no cambiaron', (
    tester,
  ) async {
    await _pumpShell(tester, dark: false);

    // Search field: white fill, hairline #D9E2EC border, muted hint.
    final search = find.descendant(
      of: find.byType(JobSearchBar),
      matching: find.byType(EditableText),
    );
    expect(_backgroundBehind(tester, search), Colors.white);
    expect(_borderBehind(tester, search), const Color(0xFFD9E2EC));
    expect(
      _textColor(tester, find.text('Cargo, empresa o distrito')),
      const Color(0xFF718096),
    );
    // Filter chip: white fill, same hairline border, navy label.
    final chip = find.descendant(
      of: find.widgetWithText(FilterChip, 'Urgentes'),
      matching: find.text('Urgentes'),
    );
    expect(_backgroundBehind(tester, chip), Colors.white);
    expect(_borderBehind(tester, chip), const Color(0xFFD9E2EC));
    expect(_textColor(tester, chip), AppColors.navy);

    await _openFilterSheet(tester);
    final light = buildAppTheme(Brightness.light);
    expect(light.dividerColor, const Color(0xFF707974));
    for (var i = 0; i < 6; i++) {
      final dropdown = _dropdowns.at(i);
      final widget = tester.widget<DropdownButton<dynamic>>(dropdown);
      final label = find.descendant(
        of: dropdown,
        matching: find.text(_selectedLabel(widget).data!),
      );
      expect(_backgroundBehind(tester, label), Colors.white);
      expect(_borderBehind(tester, label), const Color(0xFF707974));
      expect(_textColor(tester, label), AppColors.navy);
      expect(
        _iconColor(
          tester,
          find.descendant(
            of: dropdown,
            matching: find.byIcon(Icons.arrow_drop_down),
          ),
        ),
        Colors.grey.shade700,
      );
    }
    expect(AppPalette.light.surface, Colors.white);
    expect(AppPalette.light.border, const Color(0xFFD9E2EC));
    expect(AppPalette.light.controlBorder, AppPalette.light.border);
    expect(AppPalette.light.ink, const Color(0xFF1A2B4A));
    expect(AppPalette.light.muted, const Color(0xFF718096));
  });
}
