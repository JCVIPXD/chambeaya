import 'package:cumple_now_mobile/features/profile/profile_home_page.dart';
import 'package:cumple_now_mobile/features/profile/talent_profile_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'dart:typed_data';

void main() {
  testWidgets(
    'applies the saved profile immediately without another profile load',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _ProfileRepository();

      await tester.pumpWidget(
        MaterialApp(home: ProfileHomePage(talentProfileRepository: repository)),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Añade un titular que describa tu experiencia'),
        findsOneWidget,
      );
      expect(repository.profileCalls, 1);

      await tester.tap(find.text('Editar perfil'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField).first,
        'Barista y atención al cliente',
      );
      await tester.ensureVisible(find.text('Guardar cambios'));
      await tester.tap(find.text('Guardar cambios'));
      await tester.pumpAndSettle();

      expect(find.text('Barista y atención al cliente'), findsOneWidget);
      expect(find.text('Perfil actualizado correctamente.'), findsOneWidget);
      expect(repository.profileCalls, 1);
    },
  );

  testWidgets(
    'shows explicit empty states for the four new profile sections',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _ProfileRepository();

      await tester.pumpWidget(
        MaterialApp(home: ProfileHomePage(talentProfileRepository: repository)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Radio y distritos de trabajo'), findsOneWidget);
      expect(
        find.text(
          'Aún no defines un radio ni distritos adicionales donde aceptas turnos.',
        ),
        findsOneWidget,
      );
      expect(find.text('Experiencia laboral'), findsOneWidget);
      expect(
        find.text('Añade tus puestos anteriores para reforzar tu perfil.'),
        findsOneWidget,
      );
      expect(find.text('Certificaciones'), findsOneWidget);
      expect(
        find.text('Añade cursos o certificados que hayas completado.'),
        findsOneWidget,
      );
      expect(find.text('Idiomas'), findsOneWidget);
      expect(
        find.text('Añade los idiomas que hablas y tu nivel en cada uno.'),
        findsOneWidget,
      );
      // Certifications are worker-declared metadata: never insinuate a
      // "verified" state anywhere in this screen.
      expect(find.textContaining('erificad'), findsNothing);
    },
  );

  testWidgets(
    'adds an experience, a certification, a language and a work area, '
    'and can toggle each section visibility independently',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final repository = _ProfileRepository();

      await tester.pumpWidget(
        MaterialApp(home: ProfileHomePage(talentProfileRepository: repository)),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Editar perfil'));
      await tester.pumpAndSettle();

      // Radio de trabajo.
      await tester.enterText(
        find.widgetWithText(TextField, 'Radio de trabajo (km)'),
        '15',
      );
      await tester.ensureVisible(
        find.widgetWithText(TextField, 'Agregar distrito'),
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Agregar distrito'),
        'Miraflores',
      );
      await tester.tap(find.byTooltip('Agregar distrito'));
      await tester.pumpAndSettle();
      expect(find.text('Miraflores'), findsOneWidget);

      // Experiencia laboral.
      await tester.ensureVisible(
        find.widgetWithText(TextButton, 'Agregar').first,
      );
      await tester.tap(find.widgetWithText(TextButton, 'Agregar').first);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Puesto'),
        'Mesero',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Empleador'),
        'Café Central',
      );
      await tester.tap(find.text('Elegir fecha de inicio'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      // "Trabajo aquí actualmente" ya viene marcado por defecto en una
      // entrada nueva, así que no hace falta tocarlo para dejar `endDate`
      // sin definir (puesto vigente).
      await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Mesero · Café Central'), findsOneWidget);

      // Ocultar la sección de experiencia.
      await tester.ensureVisible(
        find.text('Mostrar mi experiencia a las empresas'),
      );
      await tester.tap(find.text('Mostrar mi experiencia a las empresas'));
      await tester.pumpAndSettle();

      // Certificaciones.
      await tester.ensureVisible(
        find.widgetWithText(TextButton, 'Agregar').at(1),
      );
      await tester.tap(find.widgetWithText(TextButton, 'Agregar').at(1));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Nombre'),
        'Manipulación de alimentos',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
      await tester.pumpAndSettle();
      expect(find.text('Manipulación de alimentos'), findsOneWidget);

      // Idiomas.
      await tester.ensureVisible(
        find.widgetWithText(TextButton, 'Agregar').at(2),
      );
      await tester.tap(find.widgetWithText(TextButton, 'Agregar').at(2));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextField, 'Idioma'),
        'Inglés',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Inglés'), findsOneWidget);

      await tester.ensureVisible(find.text('Guardar cambios'));
      await tester.tap(find.text('Guardar cambios'));
      await tester.pumpAndSettle();

      final saved = repository.lastDraft!;
      expect(saved.workRadiusKm, 15);
      expect(saved.workDistricts, ['Miraflores']);
      expect(saved.experiences, hasLength(1));
      expect(saved.experiences.single.role, 'Mesero');
      expect(saved.experiences.single.employer, 'Café Central');
      expect(saved.experiences.single.endDate, isNull);
      expect(saved.isExperienceVisible, isFalse);
      expect(saved.certifications, hasLength(1));
      expect(saved.certifications.single.name, 'Manipulación de alimentos');
      expect(saved.languages, hasLength(1));
      expect(saved.languages.single.language, 'Inglés');
      expect(saved.isCertificationsVisible, isTrue);
      expect(saved.isLanguagesVisible, isTrue);
      expect(saved.isWorkAreaVisible, isTrue);
    },
  );

  testWidgets(
    'loads and edits a profile that predates the new sections without error',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      // Simulates the JSON shape a profile from before this scope would
      // have if the new keys were ever missing: the client must not throw.
      final legacyProfile = TalentProfile.fromJson(const {
        'id': 'legacy-profile',
        'name': 'Legacy Worker',
        'headline': 'Barista',
        'bio': null,
        'district': null,
        'availabilityText': null,
        'availabilityDays': <String>[],
        'availabilityPeriods': <String>[],
        'isAvailable': true,
        'isVisible': true,
        'specialties': <dynamic>[],
        'completion': 42,
        'cv': null,
        'photo': null,
      });
      final repository = _ProfileRepository(initial: legacyProfile);

      await tester.pumpWidget(
        MaterialApp(home: ProfileHomePage(talentProfileRepository: repository)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Barista'), findsOneWidget);
      expect(legacyProfile.workRadiusKm, isNull);
      expect(legacyProfile.workDistricts, isEmpty);
      expect(legacyProfile.experiences, isEmpty);
      expect(legacyProfile.certifications, isEmpty);
      expect(legacyProfile.languages, isEmpty);
      expect(legacyProfile.isExperienceVisible, isTrue);
      expect(legacyProfile.isCertificationsVisible, isTrue);
      expect(legacyProfile.isLanguagesVisible, isTrue);
      expect(legacyProfile.isWorkAreaVisible, isTrue);

      await tester.tap(find.text('Editar perfil'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Guardar cambios'));
      await tester.tap(find.text('Guardar cambios'));
      await tester.pumpAndSettle();

      expect(find.text('Perfil actualizado correctamente.'), findsOneWidget);
    },
  );
}

class _ProfileRepository implements TalentProfileRepository {
  _ProfileRepository({TalentProfile? initial})
    : _profile = initial ?? _defaultProfile;
  var profileCalls = 0;
  TalentProfile _profile;
  TalentProfileDraft? lastDraft;

  static const _defaultProfile = TalentProfile(
    id: 'profile-1',
    name: 'Ana Torres',
    headline: null,
    bio: null,
    district: null,
    availabilityText: null,
    availabilityDays: [],
    availabilityPeriods: [],
    isAvailable: true,
    isVisible: true,
    specialties: [],
    completion: 0,
    cv: null,
    photo: null,
    workRadiusKm: null,
    workDistricts: [],
    isExperienceVisible: true,
    isCertificationsVisible: true,
    isLanguagesVisible: true,
    isWorkAreaVisible: true,
    experiences: [],
    certifications: [],
    languages: [],
  );

  @override
  Future<TalentProfile> profile() async {
    profileCalls++;
    return _profile;
  }

  @override
  Future<List<Specialty>> specialties() async => const [
    Specialty(
      id: 'barista',
      slug: 'barista',
      name: 'Barista',
      category: 'Gastronomía',
    ),
  ];

  @override
  Future<TalentProfile> update(TalentProfileDraft draft) async {
    lastDraft = draft;
    _profile = TalentProfile(
      id: _profile.id,
      name: _profile.name,
      headline: draft.headline,
      bio: draft.bio,
      district: draft.district,
      availabilityText: draft.availabilityText,
      availabilityDays: draft.availabilityDays,
      availabilityPeriods: draft.availabilityPeriods,
      isAvailable: draft.isAvailable,
      isVisible: draft.isVisible,
      specialties: draft.specialties
          .map(
            (selection) => Specialty(
              id: selection.specialtyId,
              slug: selection.specialtyId,
              name: selection.specialtyId,
              category: 'Especialidad',
              proficiency: selection.proficiency,
              yearsExperience: selection.yearsExperience,
            ),
          )
          .toList(),
      completion: 100,
      cv: _profile.cv,
      photo: _profile.photo,
      workRadiusKm: draft.workRadiusKm,
      workDistricts: draft.workDistricts,
      isExperienceVisible: draft.isExperienceVisible,
      isCertificationsVisible: draft.isCertificationsVisible,
      isLanguagesVisible: draft.isLanguagesVisible,
      isWorkAreaVisible: draft.isWorkAreaVisible,
      experiences: [
        for (var index = 0; index < draft.experiences.length; index++)
          WorkExperience(
            id: 'exp-$index',
            role: draft.experiences[index].role,
            employer: draft.experiences[index].employer,
            description: draft.experiences[index].description,
            startDate: draft.experiences[index].startDate,
            endDate: draft.experiences[index].endDate,
          ),
      ],
      certifications: [
        for (var index = 0; index < draft.certifications.length; index++)
          Certification(
            id: 'cert-$index',
            name: draft.certifications[index].name,
            issuer: draft.certifications[index].issuer,
            issueDate: draft.certifications[index].issueDate,
            expirationDate: draft.certifications[index].expirationDate,
            credentialId: draft.certifications[index].credentialId,
          ),
      ],
      languages: [
        for (var index = 0; index < draft.languages.length; index++)
          Language(
            id: 'lang-$index',
            language: draft.languages[index].language,
            proficiency: draft.languages[index].proficiency,
          ),
      ],
    );
    return _profile;
  }

  @override
  Future<TalentProfile> uploadCv({
    required String filename,
    required Uint8List bytes,
  }) async {
    _profile = _profile.copyWith(
      cv: CvDocument(
        originalName: filename,
        mediaType: 'application/pdf',
        sizeBytes: bytes.length,
        updatedAt: DateTime.now(),
      ),
    );
    return _profile;
  }

  @override
  Future<TalentProfile> uploadProfilePhoto({
    required String filename,
    required Uint8List bytes,
  }) async => _profile;

  @override
  Future<Uint8List?> profilePhoto() async => null;
}
