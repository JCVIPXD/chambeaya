import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';

class Specialty {
  const Specialty({
    required this.id,
    required this.slug,
    required this.name,
    required this.category,
    this.proficiency,
    this.yearsExperience,
  });
  final String id;
  final String slug;
  final String name;
  final String category;
  final String? proficiency;
  final int? yearsExperience;

  factory Specialty.fromJson(Map<String, dynamic> json) => Specialty(
    id: json['id'] as String,
    slug: json['slug'] as String,
    name: json['name'] as String,
    category: json['category'] as String,
    proficiency: json['proficiency'] as String?,
    yearsExperience: (json['yearsExperience'] as num?)?.toInt(),
  );
}

class CvDocument {
  const CvDocument({
    required this.originalName,
    required this.mediaType,
    required this.sizeBytes,
    required this.updatedAt,
  });

  final String originalName;
  final String mediaType;
  final int sizeBytes;
  final DateTime updatedAt;

  factory CvDocument.fromJson(Map<String, dynamic> json) => CvDocument(
    originalName: json['originalName'] as String,
    mediaType: json['mediaType'] as String,
    sizeBytes: (json['sizeBytes'] as num).toInt(),
    updatedAt: DateTime.parse(json['updatedAt'] as String),
  );
}

class ProfilePhoto {
  const ProfilePhoto({
    required this.originalName,
    required this.mediaType,
    required this.sizeBytes,
    required this.updatedAt,
  });

  final String originalName;
  final String mediaType;
  final int sizeBytes;
  final DateTime updatedAt;

  factory ProfilePhoto.fromJson(Map<String, dynamic> json) => ProfilePhoto(
    originalName: json['originalName'] as String,
    mediaType: json['mediaType'] as String,
    sizeBytes: (json['sizeBytes'] as num).toInt(),
    updatedAt: DateTime.parse(json['updatedAt'] as String),
  );
}

/// Una entrada de experiencia laboral declarada por el trabajador. `endDate`
/// ausente significa puesto vigente.
class WorkExperience {
  const WorkExperience({
    required this.id,
    required this.role,
    required this.employer,
    required this.description,
    required this.startDate,
    required this.endDate,
  });

  final String id;
  final String role;
  final String employer;
  final String? description;
  final DateTime startDate;
  final DateTime? endDate;

  factory WorkExperience.fromJson(Map<String, dynamic> json) =>
      WorkExperience(
        id: json['id'] as String,
        role: json['role'] as String,
        employer: json['employer'] as String,
        description: json['description'] as String?,
        startDate: DateTime.parse(json['startDate'] as String),
        endDate: json['endDate'] == null
            ? null
            : DateTime.parse(json['endDate'] as String),
      );
}

/// Metadato de certificación declarado por el trabajador. A propósito no
/// tiene ningún campo de verificación: el servidor tampoco lo tiene (ver
/// `WorkerCertification` en `schema.prisma`) y esta interfaz no debe
/// insinuar un estado de "verificado" que no existe.
class Certification {
  const Certification({
    required this.id,
    required this.name,
    required this.issuer,
    required this.issueDate,
    required this.expirationDate,
    required this.credentialId,
  });

  final String id;
  final String name;
  final String? issuer;
  final DateTime? issueDate;
  final DateTime? expirationDate;
  final String? credentialId;

  factory Certification.fromJson(Map<String, dynamic> json) => Certification(
    id: json['id'] as String,
    name: json['name'] as String,
    issuer: json['issuer'] as String?,
    issueDate: json['issueDate'] == null
        ? null
        : DateTime.parse(json['issueDate'] as String),
    expirationDate: json['expirationDate'] == null
        ? null
        : DateTime.parse(json['expirationDate'] as String),
    credentialId: json['credentialId'] as String?,
  );
}

class Language {
  const Language({
    required this.id,
    required this.language,
    required this.proficiency,
  });

  final String id;
  final String language;
  final String proficiency;

  factory Language.fromJson(Map<String, dynamic> json) => Language(
    id: json['id'] as String,
    language: json['language'] as String,
    proficiency: json['proficiency'] as String,
  );
}

class TalentProfile {
  const TalentProfile({
    required this.id,
    required this.name,
    required this.headline,
    required this.bio,
    required this.district,
    required this.availabilityText,
    required this.availabilityDays,
    required this.availabilityPeriods,
    required this.isAvailable,
    required this.isVisible,
    required this.specialties,
    required this.completion,
    required this.cv,
    required this.photo,
    required this.workRadiusKm,
    required this.workDistricts,
    required this.isExperienceVisible,
    required this.isCertificationsVisible,
    required this.isLanguagesVisible,
    required this.isWorkAreaVisible,
    required this.experiences,
    required this.certifications,
    required this.languages,
  });

  final String id;
  final String name;
  final String? headline;
  final String? bio;
  final String? district;
  final String? availabilityText;
  final List<String> availabilityDays;
  final List<String> availabilityPeriods;
  final bool isAvailable;
  final bool isVisible;
  final List<Specialty> specialties;
  final int completion;
  final CvDocument? cv;
  final ProfilePhoto? photo;
  final int? workRadiusKm;
  final List<String> workDistricts;
  final bool isExperienceVisible;
  final bool isCertificationsVisible;
  final bool isLanguagesVisible;
  final bool isWorkAreaVisible;
  final List<WorkExperience> experiences;
  final List<Certification> certifications;
  final List<Language> languages;

  factory TalentProfile.fromJson(Map<String, dynamic> json) => TalentProfile(
    id: json['id'] as String,
    name: json['name'] as String,
    headline: json['headline'] as String?,
    bio: json['bio'] as String?,
    district: json['district'] as String?,
    availabilityText: json['availabilityText'] as String?,
    availabilityDays: (json['availabilityDays'] as List<dynamic>? ?? const [])
        .cast<String>(),
    availabilityPeriods:
        (json['availabilityPeriods'] as List<dynamic>? ?? const [])
            .cast<String>(),
    isAvailable: json['isAvailable'] == true,
    isVisible: json['isVisible'] == true,
    specialties: (json['specialties'] as List<dynamic>? ?? const [])
        .map((value) => Specialty.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
    completion: (json['completion'] as num?)?.toInt() ?? 0,
    cv: json['cv'] is Map<String, dynamic>
        ? CvDocument.fromJson(json['cv'] as Map<String, dynamic>)
        : null,
    photo: json['photo'] is Map<String, dynamic>
        ? ProfilePhoto.fromJson(json['photo'] as Map<String, dynamic>)
        : null,
    // Un perfil creado antes de este alcance no trae estas claves; el
    // servidor las inicializa con estos mismos valores por defecto
    // (radio/distritos vacíos, las cuatro secciones visibles), así que un
    // perfil viejo se sigue cargando y editando sin error.
    workRadiusKm: (json['workRadiusKm'] as num?)?.toInt(),
    workDistricts: (json['workDistricts'] as List<dynamic>? ?? const [])
        .cast<String>(),
    isExperienceVisible: json['isExperienceVisible'] as bool? ?? true,
    isCertificationsVisible: json['isCertificationsVisible'] as bool? ?? true,
    isLanguagesVisible: json['isLanguagesVisible'] as bool? ?? true,
    isWorkAreaVisible: json['isWorkAreaVisible'] as bool? ?? true,
    experiences: (json['experiences'] as List<dynamic>? ?? const [])
        .map((value) => WorkExperience.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
    certifications: (json['certifications'] as List<dynamic>? ?? const [])
        .map((value) => Certification.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
    languages: (json['languages'] as List<dynamic>? ?? const [])
        .map((value) => Language.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
  );

  TalentProfile copyWith({CvDocument? cv, ProfilePhoto? photo}) =>
      TalentProfile(
        id: id,
        name: name,
        headline: headline,
        bio: bio,
        district: district,
        availabilityText: availabilityText,
        availabilityDays: availabilityDays,
        availabilityPeriods: availabilityPeriods,
        isAvailable: isAvailable,
        isVisible: isVisible,
        specialties: specialties,
        completion: completion,
        cv: cv ?? this.cv,
        photo: photo ?? this.photo,
        workRadiusKm: workRadiusKm,
        workDistricts: workDistricts,
        isExperienceVisible: isExperienceVisible,
        isCertificationsVisible: isCertificationsVisible,
        isLanguagesVisible: isLanguagesVisible,
        isWorkAreaVisible: isWorkAreaVisible,
        experiences: experiences,
        certifications: certifications,
        languages: languages,
      );
}

class TalentSpecialtyDraft {
  const TalentSpecialtyDraft({
    required this.specialtyId,
    required this.proficiency,
    this.yearsExperience,
  });
  final String specialtyId;
  final String proficiency;
  final int? yearsExperience;

  Map<String, dynamic> toJson() => {
    'specialtyId': specialtyId,
    'proficiency': proficiency,
    'yearsExperience': yearsExperience,
  };
}

/// Borrador de una entrada de experiencia laboral, sin `id`: cada `PATCH`
/// reemplaza la lista completa de la sección (mismo patrón que
/// `specialties`), así que el servidor asigna un `id` nuevo cada vez.
class WorkExperienceDraft {
  const WorkExperienceDraft({
    required this.role,
    required this.employer,
    this.description,
    required this.startDate,
    this.endDate,
  });
  final String role;
  final String employer;
  final String? description;
  final DateTime startDate;
  final DateTime? endDate;

  Map<String, dynamic> toJson() => {
    'role': role,
    'employer': employer,
    'description': description,
    'startDate': startDate.toIso8601String(),
    'endDate': endDate?.toIso8601String(),
  };
}

/// Borrador de una certificación. A propósito no tiene ningún campo de
/// verificación (ver `Certification` arriba).
class CertificationDraft {
  const CertificationDraft({
    required this.name,
    this.issuer,
    this.issueDate,
    this.expirationDate,
    this.credentialId,
  });
  final String name;
  final String? issuer;
  final DateTime? issueDate;
  final DateTime? expirationDate;
  final String? credentialId;

  Map<String, dynamic> toJson() => {
    'name': name,
    'issuer': issuer,
    'issueDate': issueDate?.toIso8601String(),
    'expirationDate': expirationDate?.toIso8601String(),
    'credentialId': credentialId,
  };
}

class LanguageDraft {
  const LanguageDraft({required this.language, required this.proficiency});
  final String language;
  final String proficiency;

  Map<String, dynamic> toJson() => {
    'language': language,
    'proficiency': proficiency,
  };
}

class TalentProfileDraft {
  const TalentProfileDraft({
    required this.headline,
    required this.bio,
    required this.district,
    required this.availabilityText,
    required this.availabilityDays,
    required this.availabilityPeriods,
    required this.isAvailable,
    required this.isVisible,
    required this.specialties,
    required this.workRadiusKm,
    required this.workDistricts,
    required this.isExperienceVisible,
    required this.isCertificationsVisible,
    required this.isLanguagesVisible,
    required this.isWorkAreaVisible,
    required this.experiences,
    required this.certifications,
    required this.languages,
  });
  final String? headline;
  final String? bio;
  final String? district;
  final String? availabilityText;
  final List<String> availabilityDays;
  final List<String> availabilityPeriods;
  final bool isAvailable;
  final bool isVisible;
  final List<TalentSpecialtyDraft> specialties;
  final int? workRadiusKm;
  final List<String> workDistricts;
  final bool isExperienceVisible;
  final bool isCertificationsVisible;
  final bool isLanguagesVisible;
  final bool isWorkAreaVisible;
  final List<WorkExperienceDraft> experiences;
  final List<CertificationDraft> certifications;
  final List<LanguageDraft> languages;

  Map<String, dynamic> toJson() => {
    'headline': headline,
    'bio': bio,
    'district': district,
    'availabilityText': availabilityText,
    'availabilityDays': availabilityDays,
    'availabilityPeriods': availabilityPeriods,
    'isAvailable': isAvailable,
    'isVisible': isVisible,
    'specialties': specialties.map((item) => item.toJson()).toList(),
    'workRadiusKm': workRadiusKm,
    'workDistricts': workDistricts,
    'isExperienceVisible': isExperienceVisible,
    'isCertificationsVisible': isCertificationsVisible,
    'isLanguagesVisible': isLanguagesVisible,
    'isWorkAreaVisible': isWorkAreaVisible,
    'experiences': experiences.map((item) => item.toJson()).toList(),
    'certifications': certifications.map((item) => item.toJson()).toList(),
    'languages': languages.map((item) => item.toJson()).toList(),
  };
}

abstract interface class TalentProfileRepository {
  Future<TalentProfile> profile();
  Future<List<Specialty>> specialties();
  Future<TalentProfile> update(TalentProfileDraft draft);
  Future<TalentProfile> uploadCv({
    required String filename,
    required Uint8List bytes,
  });
  Future<TalentProfile> uploadProfilePhoto({
    required String filename,
    required Uint8List bytes,
  });
  Future<Uint8List?> profilePhoto();
}

class HttpTalentProfileRepository implements TalentProfileRepository {
  HttpTalentProfileRepository({http.Client? client, Uri? baseUri, this.token})
    : _client = client ?? http.Client(),
      _baseUri = baseUri ?? Uri.parse(AppConfig.apiBaseUrl);

  final http.Client _client;
  final Uri _baseUri;
  final String? token;

  Map<String, String> get _headers =>
      token == null ? const {} : {'Authorization': 'Bearer $token'};

  @override
  Future<TalentProfile> profile() async {
    final response = await _client
        .get(_baseUri.resolve('/api/workers/me/profile'), headers: _headers)
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw StateError('No se pudo cargar tu perfil');
    }
    return TalentProfile.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  @override
  Future<List<Specialty>> specialties() async {
    final response = await _client
        .get(_baseUri.resolve('/api/specialties'), headers: _headers)
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw StateError('No se pudieron cargar las especialidades');
    }
    return (jsonDecode(response.body) as List<dynamic>)
        .map((value) => Specialty.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
  }

  @override
  Future<TalentProfile> update(TalentProfileDraft draft) async {
    final response = await _client
        .patch(
          _baseUri.resolve('/api/workers/me/profile'),
          headers: {..._headers, 'Content-Type': 'application/json'},
          body: jsonEncode(draft.toJson()),
        )
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw StateError('No se pudo guardar tu perfil');
    }
    return TalentProfile.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  @override
  Future<TalentProfile> uploadCv({
    required String filename,
    required Uint8List bytes,
  }) async {
    final response = await _client
        .put(
          _baseUri.resolve('/api/workers/me/cv'),
          headers: {
            ..._headers,
            'Content-Type': 'application/pdf',
            'X-File-Name': Uri.encodeComponent(filename),
          },
          body: bytes,
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 201) {
      throw StateError('No se pudo subir tu CV');
    }
    return TalentProfile.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  @override
  Future<TalentProfile> uploadProfilePhoto({
    required String filename,
    required Uint8List bytes,
  }) async {
    final response = await _client
        .put(
          _baseUri.resolve('/api/workers/me/photo'),
          headers: {
            ..._headers,
            'Content-Type': _photoMediaType(filename),
            'X-File-Name': Uri.encodeComponent(filename),
          },
          body: bytes,
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 201) {
      throw StateError('No se pudo guardar la foto de perfil');
    }
    return TalentProfile.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  @override
  Future<Uint8List?> profilePhoto() async {
    final response = await _client
        .get(_baseUri.resolve('/api/workers/me/photo'), headers: _headers)
        .timeout(const Duration(seconds: 12));
    if (response.statusCode == 404) return null;
    if (response.statusCode != 200) {
      throw StateError('No se pudo cargar la foto de perfil');
    }
    return response.bodyBytes;
  }
}

class DemoTalentProfileRepository implements TalentProfileRepository {
  DemoTalentProfileRepository({required this.name});
  final String name;
  TalentProfile? _profile;

  @override
  Future<TalentProfile> profile() async => _profile ??= TalentProfile(
    id: 'demo-profile',
    name: name,
    headline: null,
    bio: null,
    district: null,
    availabilityText: null,
    availabilityDays: const [],
    availabilityPeriods: const [],
    isAvailable: true,
    isVisible: true,
    specialties: const [],
    completion: 0,
    cv: null,
    photo: null,
    workRadiusKm: null,
    workDistricts: const [],
    isExperienceVisible: true,
    isCertificationsVisible: true,
    isLanguagesVisible: true,
    isWorkAreaVisible: true,
    experiences: const [],
    certifications: const [],
    languages: const [],
  );

  @override
  Future<List<Specialty>> specialties() async => const [];

  @override
  Future<TalentProfile> update(TalentProfileDraft draft) async {
    final current = await profile();
    _profile = TalentProfile(
      id: current.id,
      name: current.name,
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
          .toList(growable: false),
      completion: 0,
      cv: current.cv,
      photo: current.photo,
      workRadiusKm: draft.workRadiusKm,
      workDistricts: draft.workDistricts,
      isExperienceVisible: draft.isExperienceVisible,
      isCertificationsVisible: draft.isCertificationsVisible,
      isLanguagesVisible: draft.isLanguagesVisible,
      isWorkAreaVisible: draft.isWorkAreaVisible,
      // El demo no tiene servidor que asigne `id`; se genera uno local
      // estable para esta sesión, igual de válido para la interfaz porque
      // cada guardado reemplaza la lista completa (mismo patrón que
      // `specialties`).
      experiences: [
        for (var index = 0; index < draft.experiences.length; index++)
          WorkExperience(
            id: 'demo-experience-$index',
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
            id: 'demo-certification-$index',
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
            id: 'demo-language-$index',
            language: draft.languages[index].language,
            proficiency: draft.languages[index].proficiency,
          ),
      ],
    );
    return _profile!;
  }

  @override
  Future<TalentProfile> uploadCv({
    required String filename,
    required Uint8List bytes,
  }) async {
    final current = await profile();
    _profile = current.copyWith(
      cv: CvDocument(
        originalName: filename,
        mediaType: 'application/pdf',
        sizeBytes: bytes.length,
        updatedAt: DateTime.now(),
      ),
    );
    return _profile!;
  }

  @override
  Future<TalentProfile> uploadProfilePhoto({
    required String filename,
    required Uint8List bytes,
  }) async {
    final current = await profile();
    _profile = current.copyWith(
      photo: ProfilePhoto(
        originalName: filename,
        mediaType: _photoMediaType(filename),
        sizeBytes: bytes.length,
        updatedAt: DateTime.now(),
      ),
    );
    return _profile!;
  }

  @override
  Future<Uint8List?> profilePhoto() async => null;
}

String _photoMediaType(String filename) {
  final name = filename.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
