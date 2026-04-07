/**
 * lang.js — Global bilingual translation system for Preos.
 *
 * Usage:
 *   window.PreosLang.t('nav_buy')          → current-language string
 *   window.setLang('en')                   → switch language
 *   <span data-i18n="nav_buy">            → auto-translated text node
 *   <input data-i18n-placeholder="nav_search_placeholder">
 */

window.PreosLang = (function () {

  /* ─────────────────────────────────────────────────────────────────
     String table
  ──────────────────────────────────────────────────────────────────── */
  var strings = {
    es: {
      // Nav
      nav_buy:                'Comprar',
      nav_sell:               'Vender',
      nav_agents:             'Agentes Preos',
      nav_why:                '¿Por qué Preos?',
      nav_signin:             'Ingresar',
      nav_myaccount:          'Mi cuenta',
      nav_myfavs:             'Mis favoritos',
      nav_signout:            'Cerrar sesión',
      nav_search_placeholder: 'Busca por ciudad, dirección o código postal',

      // Hero
      hero_title_1:   'La forma más fácil de comprar',
      hero_title_2:   'una propiedad, es con Preos',
      hero_subtitle:  'Precio real, agentes con salario fijo y datos en tiempo real. Sin sorpresas.',
      hero_cta_search:'Buscar propiedades',
      hero_cta_sell:  'Vender mi propiedad',

      // Marketing banner
      banner_savings_label:   'de ahorro medio por operación',
      banner_savings_caption: 'Sin comisiones ocultas ni letra pequeña',

      // Home marketing banner
      home_eyebrow:   'Costa del Sol · Málaga',
      home_hero_title:'Tu próxima casa. Sin comisiones que te roben el sueño.',
      home_hero_sub:  'Hasta un 70% menos en comisiones. Agentes asalariados. Transparencia total.',
      home_hero_badge:'Ahorro medio: €17.500',
      home_hero_cta:  '¿Por qué Preos?',
      home_hero_cta2: 'Ver todas las propiedades →',

      // Agentes page
      agents_hero_title:       'Agentes que trabajan para ti, no por su comisión.',
      agents_hero_sub:         'En Preos, nuestros agentes cobran salario fijo. Su único incentivo es que tú estés satisfecho.',
      agents_stat1_val:        '24/7',
      agents_stat1_label:      'Disponibilidad',
      agents_stat2_val:        'NPS >80',
      agents_stat2_label:      'Satisfacción objetivo',
      agents_stat3_val:        '0€',
      agents_stat3_label:      'Comisión oculta',
      agents_model_title:      '¿Por qué importa el modelo de salario?',
      agents_model_body:       'Un agente tradicional cobra solo si vende, y cuanto más alto el precio, mejor para él. Eso crea un conflicto de interés directo con el comprador. En Preos, eliminamos ese conflicto: nuestros agentes cobran sueldo fijo y bonus por satisfacción del cliente (NPS). El resultado: más honestidad, menos presión, mejores decisiones.',
      agents_pillars_tag:      'Por qué Preos',
      agents_pillars_heading:  'Un modelo diferente',
      agents_p1_title:         'Salario fijo, sin comisiones',
      agents_p1_desc:          'Olvídate de la presión de vender para cobrar. En Preos cobrarás un salario competitivo para que te centres en lo que importa: el cliente.',
      agents_p2_title:         'Éxito medido por satisfacción',
      agents_p2_desc:          'Tu desempeño se mide por las valoraciones de tus clientes, no por el número de ventas. Calidad sobre cantidad.',
      agents_p3_title:         'Crece con nosotros',
      agents_p3_desc:          'Formación continua, herramientas digitales de última generación y un equipo que te apoya en cada paso.',
      agents_req_tag:          'Requisitos',
      agents_req_heading:      '¿Qué buscamos?',
      agents_req1:             'Experiencia en inmobiliaria o atención al cliente',
      agents_req2:             'Pasión por ayudar a las personas',
      agents_req3:             'Basado/a en la zona de Málaga',
      agents_req_cta:          'Solicitar información',
      agents_modal_title:      'Solicitar información',
      agents_form_name:        'Nombre',
      agents_form_name_ph:     'Tu nombre completo',
      agents_form_email:       'Email',
      agents_form_phone:       'Teléfono',
      agents_form_exp:         'Años de experiencia',
      agents_form_exp_ph:      'Selecciona...',
      agents_form_submit:      'Enviar solicitud',

      // Why Preos page — hero
      why_hero_title: 'El mercado inmobiliario lleva décadas sin cambiar. Nosotros lo cambiamos.',
      why_hero_sub:   'Agentes asalariados, tecnología transparente, y hasta un 70% menos en comisiones.',
      why_hero_cta1:  'Ver propiedades',
      why_hero_cta2:  'Vender con Preos',

      // Why Preos page — savings banner
      why_savings_stat:    '€17.500',
      why_savings_label:   'Ahorro medio en una vivienda de €500.000 en Costa del Sol',
      why_savings_caption: 'Frente a una agencia tradicional con comisión del 6%',

      // Why Preos page — pillars section
      why_pillars_title:  'Una forma diferente de trabajar',
      why_p1_title: 'Precio justo',
      why_p1_desc:  '1,5–2% para propiedades exclusivas Preos. Sin letra pequeña, sin honorarios ocultos.',
      why_p2_title: 'Transparencia total',
      why_p2_desc:  'Datos verificados, precios reales y el proceso siempre visible.',
      why_p3_title: 'Agentes de tu lado',
      why_p3_desc:  'Nuestros agentes cobran sueldo fijo. Su objetivo es tu satisfacción, no cerrar la venta más rápida.',

      // Why Preos page — comparison table
      why_compare_title:       'Tradicional vs. Preos',
      why_compare_aspect:      'Aspecto',
      why_compare_traditional: 'Agencia tradicional',
      why_compare_preos:       'Preos',
      why_row1_aspect:  'Comisión',
      why_row1_trad:    '5–8% (hasta €40.000)',
      why_row1_preos:   '1,5–2% exclusivas / ~2,5% co-agencia',
      why_row2_aspect:  'Incentivo agente',
      why_row2_trad:    'Cerrar rápido, cobrar más',
      why_row2_preos:   'Salario fijo + satisfacción',
      why_row3_aspect:  'Transparencia',
      why_row3_trad:    'Opaca, sin datos reales',
      why_row3_preos:   'Precios verificados y visibles',
      why_row4_aspect:  'Disponibilidad',
      why_row4_trad:    'Horario limitado',
      why_row4_preos:   'Chat y llamada 24/7',
      why_row5_aspect:  'Tecnología',
      why_row5_trad:    'Webs anticuadas',
      why_row5_preos:   'Plataforma IA',

      // Why Preos page — calculator
      why_calc_title:       '¿Cuánto ahorras con Preos?',
      why_calc_label:       'Precio de la propiedad',
      why_calc_trad_label:  'Comisión tradicional (6%)',
      why_calc_preos_label: 'Comisión Preos (1,75%)',
      why_calc_save_label:  'Tu ahorro',

      // Why Preos page — agents
      why_agents_title:    'Nuestros agentes',
      why_agents_sub:      'Profesionales certificados con salario fijo. Trabajan para ti, no para la comisión.',
      why_agents_badge:    'Salario fijo',

      // Why Preos page — final CTA
      why_cta_title:    'Empieza hoy. Sin compromiso.',
      why_cta_sub:      'Explora propiedades, habla con un agente o solicita una valoración gratuita. Sin presión.',
      why_cta_btn1:     'Ver propiedades',
      why_cta_btn2:     'Vender',

      // Why Preos section (used on other pages)
      why_eyebrow:  'Por qué Preos',
      why_title:    'Compramos diferente',
      why_subtitle: 'Una plataforma construida desde cero para ponerse del lado del comprador.',

      // Pillars
      pillar1_title: 'Precios reales',
      pillar1_desc:  'Accede al historial de precios y estimaciones de valor de cada propiedad. Sin sorpresas ni datos inventados.',
      pillar2_title: 'Agentes con salario fijo',
      pillar2_desc:  'Nuestros agentes cobran salario, no comisiones. Su único objetivo es que estés feliz con tu decisión.',
      pillar3_title: 'Datos en tiempo real',
      pillar3_desc:  'Conectados a las principales fuentes del mercado español para que siempre estés un paso adelante.',

      // Comparison table
      compare_title:       'Preos vs. agencia tradicional',
      compare_aspect:      'Aspecto',
      compare_traditional: 'Agencia tradicional',
      compare_preos:       'Preos',

      // Savings calculator
      calc_title:        '¿Cuánto puedes ahorrar?',
      calc_label:        'Precio de la propiedad',
      calc_trad_label:   'Comisión tradicional (5%)',
      calc_preos_label:  'Tarifa Preos (1,5%)',
      calc_saving_label: 'Tu ahorro estimado',

      // Agents
      agents_title:        'Nuestros agentes',
      agents_subtitle:     'Profesionales certificados con salario fijo. Trabajan para ti, no para la comisión.',
      agents_salary_badge: 'Salario fijo',

      // Sell page
      sell_title:    'Vende con Preos',
      sell_subtitle: 'Pon tu propiedad en el mercado con la plataforma más transparente de España.',

      // Footer
      footer_tagline:       'La plataforma inmobiliaria más fácil de España.',
      footer_rights:        '© 2026 Preos. Todos los derechos reservados.',
      footer_rent:          'Alquilar',
      footer_new_build:     'Obra nueva',
      footer_commercial:    'Locales comerciales',
      footer_about:         'Quiénes somos',
      footer_agents_link:   'Agentes',
      footer_blog:          'Blog',
      footer_contact:       'Contacto',
      footer_privacy:       'Privacidad',
      footer_terms:         'Términos de uso',
      footer_cookies:       'Cookies',
      footer_legal_notice:  'Aviso legal',
      home_recommended:     'Propiedades que te recomendamos ver',

      // Buscar page
      buscar_results: 'resultados',
      buscar_in:      'en Málaga',

      // Property page
      prop_contact_agent: 'Contactar agente',
      prop_book_visit:    'Programar recorrido',
      prop_tour_3d:       'Recorrido 3D',

      // Misc
      recommended_title: 'Propiedades que te recomendamos ver',

      // Footer headings
      footer_explore: 'EXPLORAR',
      footer_company: 'EMPRESA',
      footer_legal:   'LEGAL',

      search_placeholder:           'Ciudad, barrio o dirección...',
      search_results_in:            'propiedades en',
      search_no_results_title:      'No encontramos propiedades en',
      search_no_results_sub:        'Prueba con una ciudad cercana o amplía tu búsqueda',
      search_all_properties:        'Ver todas las propiedades',
      search_cities_label:          'Ciudades',
      search_neighbourhoods_label:  'Barrios',
      search_properties_label:      'Propiedades',

      // Buscar filter bar
      filter_price:        'Precio',
      filter_rooms:        'Habitaciones',
      filter_type:         'Tipo de propiedad',
      filter_more:         'Más filtros',
      filter_price_any:    'Cualquier precio',
      filter_price_to_200k:'Hasta €200k',
      filter_price_200_400:'€200k – €400k',
      filter_price_400_700:'€400k – €700k',
      filter_price_700_1m: '€700k – €1M',
      filter_price_over_1m:'Más de €1M',
      filter_rooms_any:    'Cualquier número',
      filter_tipo_all:     'Todos',
      filter_tipo_piso:    'Piso',
      filter_tipo_casa:    'Casa',
      filter_tipo_villa:   'Villa',
      filter_tipo_atico:   'Ático',
      filter_tipo_local:   'Local',
      sort_label:          'Ordenar por:',
      sort_recommended:    'Recomendados',
      sort_price_asc:      'Precio: menor a mayor',
      sort_price_desc:     'Precio: mayor a menor',
      sort_newest:         'Más recientes',

      // Property card bilingual
      card_bedrooms:            'hab.',
      card_bathrooms_singular:  'baño',
      card_bathrooms_plural:    'baños',
      card_new:                 'Nuevo',
      card_3d_tour:             'Recorrido 3D',

      // Expanded filters
      filter_bathrooms:         'Baños',
      filter_baths_any:         'Cualquier número',
      filter_status:            'Estado',
      filter_status_all:        'Todos',
      filter_status_nueva:      'Obra nueva',
      filter_status_resale:     'Segunda mano',
      filter_status_bank:       'Banco',
      filter_size:              'Superficie (m²)',
      filter_size_min:          'Mínimo',
      filter_size_max:          'Máximo',
      filter_size_any:          'Sin límite',
      filter_features:          'Características',
      feat_pool:                'Piscina',
      feat_garage:              'Garaje',
      feat_garden:              'Jardín',
      feat_terrace:             'Terraza',
      feat_elevator:            'Ascensor',
      feat_ac:                  'Aire acondicionado',
      feat_sea_views:           'Vistas al mar',
      feat_beachfront:          'Primera línea de playa',
      feat_home_auto:           'Domótica',
      filter_year_built:        'Año de construcción',
      filter_year_any:          'Cualquier año',
      filter_year_before_2000:  'Antes de 2000',
      filter_year_2000_2010:    '2000–2010',
      filter_year_2010_2020:    '2010–2020',
      filter_year_after_2020:   'Después de 2020',
      filter_3d_tour:           'Con Recorrido 3D',
      filter_apply:             'Aplicar filtros',
      filter_clear:             'Limpiar',
      mobile_map_toggle_map:    'Ver mapa',
      mobile_map_toggle_list:   'Ver lista',

      bookingName:              'Nombre completo',
      bookingPhone:             'Teléfono',
      bookingMessage:           'Mensaje al agente (opcional)',
      bookingConfirm:           'Confirmar recorrido',
      bookingSuccess:           'Un agente de Preos se pondrá en contacto contigo en menos de 2 horas.',
      bookingNameRequired:      'Por favor introduce tu nombre.',
      bookingPhoneRequired:     'Por favor introduce tu teléfono.',
      moreDates:                'Ver más fechas disponibles →',
      listed_by:                'Publicado por',
      activity_days_on_preos:   'días en Preos',
      activity_views:           'visitas',
      activity_saves:           'guardados',
      activity_tours:           'recorridos agendados',
      popular_title:            'Esta propiedad es popular',
      popular_desc:             'Está entre el 10% más visto en Preos. No pierdas la oportunidad.',
      nav_overview:             'Descripción',
      nav_neighborhood:         'Barrio',
      nav_details:              'Detalles',
      nav_history:              'Historial',
      nav_climate:              'Clima',
      market_insights_title:    'Insights del mercado',
      market_type_balanced:     'Mercado equilibrado',
      insight_list_sale:        'Precio venta / lista',
      insight_days_market:      'Días en mercado (media)',
      insight_competing:        'Ofertas competidoras',
      market_insights_coming:   'Datos de mercado próximamente',
      nb_loading:               'Cargando datos del barrio...',
      nb_error:                 'Datos no disponibles',
      nb_source:                'Fuente: OpenStreetMap',
      nb_walkers_paradise:      'Paraíso peatonal',
      nb_very_walkable:         'Muy caminable',
      nb_walkable:              'Caminable',
      nb_some_walk:             'Algo caminable',
      nb_car_dependent:         'Dependiente del coche',
      nb_excellent_transit:     'Transporte excelente',
      nb_good_transit:          'Buen transporte',
      nb_some_transit:          'Transporte moderado',
      nb_minimal_transit:       'Transporte mínimo',
      nb_no_transit:            'Sin transporte',
      nb_bikers_paradise:       'Paraíso ciclista',
      nb_very_bikeable:         'Muy ciclable',
      nb_bikeable:              'Ciclable',
      nb_some_bike:             'Algo de infraestructura',
      nb_minimal_bike:          'Infraestructura mínima',
      nb_quiet:                 'Zona tranquila',
      nb_mostly_quiet:          'Bastante tranquila',
      nb_some_noise:            'Algo de ruido',
      nb_noisy:                 'Zona ruidosa',
      nb_very_noisy:            'Zona muy ruidosa',
      nb_wellness_paradise:     'Paraíso del bienestar',
      nb_healthy:               'Zona saludable',
      nb_some_wellness:         'Algo de bienestar',
      nb_limited_wellness:      'Bienestar limitado',
      nb_tree_filled:           'Zona verde',
      nb_good_green:            'Buen espacio verde',
      nb_some_green:            'Algo de verde',
      nb_limited_green:         'Verde limitado',
      catastro_title:           'Referencia Catastral',
      catastro_refcat:          'Referencia',
      catastro_address:         'Dirección oficial',
      catastro_link:            'Ver ficha en Catastro →',
      catastro_not_found:       'No disponible',
      catastro_loading:         'Consultando Catastro...',
      catastro_address_match:   '✅ Dirección verificada',
      catastro_address_mismatch:'⚠️ La dirección difiere del registro oficial',
      catastro_confidence:      'Verificación',
      cat_verified:             'Verificada ✅',
      cat_high:                 'Alta confianza',
      cat_medium:               'Confianza media',
      cat_low:                  'Revisar',
      cat_unverified:           'Sin verificar',
      cat_gps_only:             'Referencia GPS',
      places_schools:           'Colegios',
      places_places:            'Lugares',
      places_transport:         'Transporte',
      places_none_nearby:       'No hay datos disponibles',
      places_loading:           'Buscando lugares...',
      climate_flood:            'Inundación',
      climate_wildfire:         'Incendio',
      climate_heat:             'Calor',
      climate_wind:             'Viento',
      climate_air:              'Calidad del aire',
      climate_very_low:         'Muy bajo',
      climate_low:              'Bajo',
      climate_medium:           'Moderado',
      climate_medium_high:      'Medio-alto',
      climate_high:             'Alto',
      climate_very_high:        'Muy alto',
      climate_good:             'Bueno',
      climate_loading:          'Cargando datos climáticos...',
      climate_source:           'Fuente: ',
      climate_not_available:    'No disponible',
      myVisits:                 'Mis visitas',
      myProfile:                'Mi perfil',
      upcomingVisits:           'Próximas visitas',
      pastVisits:               'Visitas pasadas',
      cancelVisit:              'Cancelar visita',
      changeDate:               'Cambiar fecha',
      noVisits:                 'Todavía no tienes visitas programadas.',
      cancelConfirm:            '¿Seguro que quieres cancelar esta visita?',
      rescheduleBanner:         'Estás cambiando la fecha de tu visita.',
      statusPending:            'Pendiente',
      statusConfirmed:          'Confirmada',
      statusCompleted:          'Completada',
      statusCancelled:          'Cancelada',
      viewMyVisits:             'Ver mis visitas →',
      exploreProperties:        'Explorar propiedades',

      // Vender / agent search flow
      sellHeroTitle:            'Vende tu propiedad con el agente perfecto',
      sellSearchPlaceholder:    '¿En qué zona quieres vender? (ej. Marbella)',
      agentsIn:                 'Agentes en',
      agentsSince:              'Agente Preos desde',
      propertiesSold:           'propiedades vendidas',
      avgDays:                  'días promedio',
      requestValuation:         'Solicitar valoración gratuita',
      propertyAddress:          'Dirección aproximada (opcional)',
      aboutMe:                  'Sobre mí',
      contactAgent:             'Contacta con',
      respondTime:              'Responde en menos de 2 horas',

      // Offer flow
      myOffers:                 'Mis ofertas',
      startOffer:               'Iniciar una oferta',
      offerPrice:               'Precio de oferta',
      askingPrice:              'Precio de venta',
      arrasAmount:              'Importe de arras',
      arrasDate:                'Fecha de arras',
      closingDate:              'Fecha de cierre',
      coverLetter:              'Carta de presentación',
      offerSent:                'Oferta enviada',
      offerPending:             'Pendiente',
      offerAccepted:            'Aceptada',
      offerCountered:           'Contraoferta',
      offerRejected:            'Rechazada',
      offerWithdrawn:           'Retirada',
      withdrawOffer:            'Retirar oferta',
      withdrawConfirm:          '¿Seguro que quieres retirar esta oferta?',
      noOffers:                 'No tienes ofertas activas',
      hasMortgage:              'Tengo aprobación hipotecaria',
      cashBuyer:                'Comprador al contado',

      // Offer wizard
      offerStep1Title:      'Precio de oferta',
      offerStep1Sub:        '¿Cuánto quieres ofrecer por esta propiedad?',
      offerAskingRef:       'Precio de venta:',
      offerEqualAsking:     'Igual al precio de salida',
      offerAboveAsking:     'por encima del precio de salida',
      offerBelowAsking:     'por debajo del precio de salida',
      offerExactLabel:      'O escribe el importe exacto',
      offerPriceError:      'Por favor introduce un precio válido.',
      offerStep2Title:      'Tu situación como comprador',
      offerStep2Sub:        'Ayuda al vendedor a entender tu posición.',
      offerCashLabel:       'Comprador al contado',
      offerCashSub:         'No necesito financiación hipotecaria',
      offerMortgLabel:      'Aprobación hipotecaria',
      offerMortgSub:        'Tengo una hipoteca pre-aprobada por el banco',
      offerStep3Title:      'Arras y plazos',
      offerStep3Sub:        'Define los términos económicos y temporales de tu oferta.',
      arrasOf:              'de arras',
      arrasCalculating:     'Calculando…',
      arrasEqualRec:        'Igual al 10% recomendado',
      arrasAboveRec:        'puntos por encima del 10% recomendado',
      arrasBelowRec:        'puntos por debajo del 10% recomendado',
      arrasHint:            '💡 Lo habitual en España es el 10% del precio de oferta',
      arrasDateLabel:       'Fecha de firma de arras',
      closingDateLabel:     'Fecha estimada de cierre (escritura)',
      arrasDateHint:        '💡 Mínimo 7 días — recomendamos al menos 2 semanas para preparar la documentación',
      closingDateHint:      '💡 Mínimo 30 días desde las arras — recomendamos 45–60 días para tramitar hipoteca y notaría',
      offerStep4Title:      'Carta de presentación',
      offerStep4Sub:        'Opcional — explica al vendedor por qué eres el comprador ideal.',
      coverLetterLabel:     'Tu mensaje para el vendedor',
      coverLetterPh:        'Hola, somos una familia con dos hijos buscando nuestra primera vivienda en Marbella…',
      conditionsLabel:      'Condiciones adicionales (opcional)',
      conditionsPh:         'Sujeto a inspección técnica del edificio…',
      offerStep5Title:      'Confirma tu oferta',
      offerStep5Sub:        'Revisa los detalles antes de enviar. Podrás retirar la oferta desde',
      summaryProperty:      'Propiedad',
      summaryBuyerStatus:   'Situación',
      summaryArras:         'Arras',
      summaryArrasDate:     'Fecha arras',
      summaryClosingDate:   'Fecha cierre',
      summaryCash:          'Comprador al contado',
      summaryMortgApproved: 'Hipoteca aprobada',
      summaryFinancingTBD:  'Pendiente de financiación',
      summaryConditions:    'Condiciones adicionales',
      summaryCoverLetter:   'Carta al vendedor',
      summaryNoLetter:      'Sin carta',
      notSpecified:         'No especificado/a',
      btnBack:              '← Atrás',
      btnNext:              'Siguiente →',
      btnReviewOffer:       'Revisar oferta →',
      btnEditOffer:         '← Editar',
      btnSubmitOffer:       'Enviar oferta',
      btnSubmitting:        'Enviando…',
      btnGoBack:            '← Volver',
      offerSuccessTitle:    '¡Oferta enviada!',
      offerSuccessSub:      'Tu oferta ha sido enviada al agente. Te notificaremos cuando haya novedades.',
      btnViewMyOffers:      'Ver mis ofertas',
      btnKeepBrowsing:      'Seguir buscando',
      propNotFound:         'Propiedad no encontrada.',
      offerAuthTitle:       'Inicia sesión para continuar',
      offerAuthSub:         'Necesitas una cuenta Preos para enviar una oferta.',
      offerBreadcrumb:      'Iniciar oferta',
      offerMarketPrice:     'Precio medio en',
      offerMarketSrc:       'Fuente: Notariado',
      offerSubmitError:     'Error al enviar la oferta. Inténtalo de nuevo.',
      // Offer cards (mis-ofertas.html)
      offerSentOn:          'Enviada el',
      offerStatusSent:      'Enviada',
      offerAcceptedMsg:     '¡Tu oferta ha sido aceptada! El agente se pondrá en contacto contigo pronto.',
      offerCounteredMsg:    'El agente ha enviado una contraoferta. Contacta con Preos para continuar la negociación.',
      offerViewProp:        'Ver propiedad →',
      offerCondLabel:       'Condiciones:',
      offerDetailCash:      'Contado',
      offerDetailMortgage:  'Hipoteca aprobada',
      offerDetailArras:     'Arras:',
      offerDetailArrasDate: 'Fecha arras:',
      offerDetailClosing:   'Cierre:',
      offerEmptyTitle:      'No tienes ofertas activas',
      offerEmptySub:        'Cuando envíes una oferta sobre una propiedad, aparecerá aquí.',
      offerBrowseProps:     'Buscar propiedades',
      withdrawModalTitle:   '¿Retirar oferta?',
      withdrawModalSub:     'Esta acción no se puede deshacer.',
      btnCancel:            'Cancelar',
      btnWithdrawConfirm:   'Retirar',
      // Agent CRM (agente-dashboard.html)
      crmTitle:             'CRM Agente',
      crmNewLeads:          'Leads nuevos',
      crmAllLeads:          'Todos los leads',
      crmProperties:        'Propiedades',
      crmPropertiesSubtitle:'Propiedades con actividad de leads',
      crmSellLeads:         'Leads de venta',
      crmSellLeadsSubtitle: 'Solicitudes de valoración recibidas',
      crmOffers:            'Ofertas',
      crmLeadsPending:      'leads pendientes sin gestionar',
      crmOffersPending:     'ofertas recibidas',
      crmLabelNotes:        'Notas',
      crmNotesPh:           'Notas sobre este lead…',
      crmBtnCall:           'Llamar',
      crmBtnWhatsApp:       'WhatsApp',
      crmBtnViewProp:       'Ver propiedad',
      crmPipelineNew:       'Nuevo',
      crmPipelineContacted: 'Contactado',
      crmPipelineVisit:     'Visita programada',
      crmPipelineOffer:     'Oferta presentada',
      crmPipelineClosed:    'Cerrado',
      crmDaysAgo:           'Hace',
      crmDaysAgoSuffix:     'días',
      crmNoLeads:           'No hay leads en esta sección.',
      crmOfferSendTitle:    'Enviar oferta al vendedor',
      crmOfferAgentNote:    'Nota adicional para el agente vendedor (opcional):',
      crmOfferAgentNotePh:  'Añade cualquier nota adicional antes de enviar…',
      crmOfferNoAgent:      'Agente vendedor no identificado aún — disponible cuando se integre el MLS (Resales Online)',
      crmBtnCopyOffer:      'Copiar oferta',
      crmBtnEmailOffer:     'Enviar por email',
      crmBtnWhatsAppOffer:  'Enviar por WhatsApp',
      crmOfferCopied:       '✅ Oferta copiada al portapapeles',
      crmCopyError:         '❌ Error al copiar',
      crmLabelAskingPrice:  'Precio salida',
      crmLabelOffer:        'Oferta',
      crmLabelArras:        'Arras',
      crmLabelArrasDate:    'Fecha arras',
      crmLabelClosing:      'Fecha cierre',
      crmLabelConditions:   'Condiciones',
      crmLabelCoverLetter:  'Carta al vendedor',
      crmOfferStatusNew:    'Nueva',
      crmOfferStatusReviewed:'Revisada',
      crmOfferStatusForwarded:'Enviada al vendedor',
      crmOfferStatusAccepted:'Aceptada',
      crmOfferStatusRejected:'Rechazada',
      crmInternalNotesPh:   'Notas internas…',
      crmLabelName:         'Nombre',
      crmLabelEmail:        'Email',
      crmLabelPhone:        'Teléfono',
      crmLabelVisitDate:    'Fecha visita',
      crmLabelProperty:     'Propiedad',
      crmLabelPipeline:     'Pipeline',
      crmOfferCardHeader:   'PROPIEDAD / AGENTE VENDEDOR',
      crmOfferTerms:        'TÉRMINOS DE OFERTA',
      crmCondicionesHeader: 'CONDICIONES ADICIONALES',
      crmCartaHeader:       'CARTA AL VENDEDOR',
      crmSendOfferTitle:    'ENVIAR OFERTA AL VENDEDOR',

      // Listing Quality
      lqPremium:            'Premium',
      lqCompleto:           'Completo',
      lqLimitado:           'Limitado',
      lqIncompleto:         'Incompleto',
      lqScore:              'Puntuación de calidad',
      lqImages:             'fotos',
      lqFeatures:           'características',
      lqYes:                'Sí',
      lqNo:                 'No',
      lqMissing:            'No disponible',
      lqAnalyzing:          'Analizando calidad…',
      lqCheckImgCount:      'Número de fotos',
      lqCheckResolution:    'Resolución',
      lqCheckOrientation:   'Orientación',
      lqCheckDescription:   'Descripción',
      lqCheckFeatures:      'Características',
      lqCheck3DTour:        'Recorrido 3D',
      lqCheckLocation:      'Coordenadas GPS',
      lqCheckYearBuilt:     'Año de construcción',
      lqResNoImages:        'Sin fotos cargadas',
      lqOrientAllLandscape: 'Todas horizontal',
      lqOrientHasPortrait:  'Hay vertical(es)',
      lqOrientMixed:        'Mixta',
      lqQualityTab:         'Calidad del anuncio',
      lqSortByQuality:      'Por calidad',

      // Backward-compat dotted keys used by data-i18n attributes on existing pages
      'nav.comprar':        'Comprar',
      'nav.vender':         'Vender',
      'nav.agentes':        'Agentes Preos',
      'nav.micuenta':       'Mi cuenta',
      'nav.ingresar':       'Ingresar',
      'hero.title':         'La forma más fácil de comprar una propiedad, es con Preos',
      'hero.search':        'Busca por ciudad, dirección o código postal',
      'hero.comprar':       'Comprar',
      'hero.vender':        'Vender',
      'recommended.title':  'Propiedades que te recomendamos ver',
      'footer.explorar':    'EXPLORAR',
      'footer.empresa':     'EMPRESA',
      'footer.legal':       'LEGAL',
    },

    en: {
      // Nav
      nav_buy:                'Buy',
      nav_sell:               'Sell',
      nav_agents:             'Real Estate Agents',
      nav_why:                'Why Preos',
      nav_signin:             'Sign in',
      nav_myaccount:          'My account',
      nav_myfavs:             'Saved properties',
      nav_signout:            'Sign out',
      nav_search_placeholder: 'Search by city, address or postal code',

      // Hero
      hero_title_1:   'The easiest way to buy',
      hero_title_2:   'a property — with Preos',
      hero_subtitle:  'Honest pricing, salaried agents, real-time market data. No surprises, ever.',
      hero_cta_search:'Browse properties',
      hero_cta_sell:  'Sell my property',

      // Marketing banner
      banner_savings_label:   'average savings per transaction',
      banner_savings_caption: 'No hidden fees, no small print',

      // Home marketing banner
      home_eyebrow:   'Costa del Sol · Málaga',
      home_hero_title:'Your next home. Without fees that steal your dreams.',
      home_hero_sub:  'Up to 70% less in fees. Salaried agents. Total transparency.',
      home_hero_badge:'Average saving: €17,500',
      home_hero_cta:  'Why Preos?',
      home_hero_cta2: 'Browse all properties →',

      // Agentes page
      agents_hero_title:       'Agents working for you, not their commission.',
      agents_hero_sub:         'At Preos, our agents earn a fixed salary. Their only incentive is your satisfaction.',
      agents_stat1_val:        '24/7',
      agents_stat1_label:      'Availability',
      agents_stat2_val:        'NPS >80',
      agents_stat2_label:      'Target satisfaction',
      agents_stat3_val:        '€0',
      agents_stat3_label:      'Hidden fees',
      agents_model_title:      'Why does the salary model matter?',
      agents_model_body:       'A traditional agent only earns if they sell — and the higher the price, the better for them. That creates a direct conflict of interest with you. At Preos, we eliminate that conflict: our agents earn a fixed salary and bonuses tied to client satisfaction (NPS). The result: more honesty, less pressure, better decisions.',
      agents_pillars_tag:      'Why Preos',
      agents_pillars_heading:  'A different model',
      agents_p1_title:         'Fixed salary, no commissions',
      agents_p1_desc:          'Forget the pressure of selling to get paid. At Preos you earn a competitive salary so you can focus on what matters: the client.',
      agents_p2_title:         'Success measured by satisfaction',
      agents_p2_desc:          'Your performance is measured by client reviews, not sales volume. Quality over quantity.',
      agents_p3_title:         'Grow with us',
      agents_p3_desc:          'Ongoing training, cutting-edge digital tools, and a team that supports you at every step.',
      agents_req_tag:          'Requirements',
      agents_req_heading:      'What are we looking for?',
      agents_req1:             'Experience in real estate or customer service',
      agents_req2:             'Passion for helping people',
      agents_req3:             'Based in the Málaga area',
      agents_req_cta:          'Request information',
      agents_modal_title:      'Request information',
      agents_form_name:        'Name',
      agents_form_name_ph:     'Your full name',
      agents_form_email:       'Email',
      agents_form_phone:       'Phone',
      agents_form_exp:         'Years of experience',
      agents_form_exp_ph:      'Select...',
      agents_form_submit:      'Send request',

      // Why Preos page — hero
      why_hero_title: "Real estate hasn't changed in decades. We're changing it.",
      why_hero_sub:   'Salaried agents, transparent technology, and up to 70% less in fees.',
      why_hero_cta1:  'See properties',
      why_hero_cta2:  'Sell with Preos',

      // Why Preos page — savings banner
      why_savings_stat:    '€17,500',
      why_savings_label:   'Average saving on a €500,000 home in Costa del Sol',
      why_savings_caption: 'Compared to a traditional agency charging 6%',

      // Why Preos page — pillars section
      why_pillars_title:  'A different way to work',
      why_p1_title: 'Fair pricing',
      why_p1_desc:  '1.5–2% for Preos exclusive listings. No hidden fees, no surprises.',
      why_p2_title: 'Total transparency',
      why_p2_desc:  'Verified data, real prices, and your process visible at every step.',
      why_p3_title: 'Agents on your side',
      why_p3_desc:  'Our agents earn a fixed salary. Their goal is your satisfaction, not the fastest sale.',

      // Why Preos page — comparison table
      why_compare_title:       'Traditional vs. Preos',
      why_compare_aspect:      'Aspect',
      why_compare_traditional: 'Traditional agency',
      why_compare_preos:       'Preos',
      why_row1_aspect:  'Commission',
      why_row1_trad:    '5–8% (up to €40,000)',
      why_row1_preos:   '1.5–2% exclusive / ~2.5% co-agency',
      why_row2_aspect:  'Agent incentive',
      why_row2_trad:    'Close fast, earn more',
      why_row2_preos:   'Fixed salary + satisfaction',
      why_row3_aspect:  'Transparency',
      why_row3_trad:    'Opaque, no real data',
      why_row3_preos:   'Verified prices, always visible',
      why_row4_aspect:  'Availability',
      why_row4_trad:    'Limited hours',
      why_row4_preos:   'Chat & call 24/7',
      why_row5_aspect:  'Technology',
      why_row5_trad:    'Outdated websites',
      why_row5_preos:   'AI-powered platform',

      // Why Preos page — calculator
      why_calc_title:       'How much do you save with Preos?',
      why_calc_label:       'Property price',
      why_calc_trad_label:  'Traditional commission (6%)',
      why_calc_preos_label: 'Preos commission (1.75%)',
      why_calc_save_label:  'Your saving',

      // Why Preos page — agents
      why_agents_title:    'Our agents',
      why_agents_sub:      'Certified professionals on a fixed salary. They work for you, not for a cut.',
      why_agents_badge:    'Fixed salary',

      // Why Preos page — final CTA
      why_cta_title:    'Start today. No commitment.',
      why_cta_sub:      'Browse properties, talk to an agent, or request a free valuation. No pressure.',
      why_cta_btn1:     'See properties',
      why_cta_btn2:     'Sell',

      // Why Preos section (used on other pages)
      why_eyebrow:  'Why Preos',
      why_title:    'A smarter way to buy',
      why_subtitle: 'A platform built from the ground up to put the buyer first — always.',

      // Pillars
      pillar1_title: 'Real prices',
      pillar1_desc:  'Access full price history and independent valuation estimates for every listing. No guesswork.',
      pillar2_title: 'Salaried agents',
      pillar2_desc:  'Our agents earn a fixed salary, not commissions. Their only metric is your satisfaction.',
      pillar3_title: 'Real-time data',
      pillar3_desc:  "Connected to Spain's leading property data sources so you're always one step ahead of the market.",

      // Comparison table
      compare_title:       'Preos vs. traditional agency',
      compare_aspect:      'Aspect',
      compare_traditional: 'Traditional agency',
      compare_preos:       'Preos',

      // Savings calculator
      calc_title:        'How much could you save?',
      calc_label:        'Property price',
      calc_trad_label:   'Traditional commission (5%)',
      calc_preos_label:  'Preos fee (1.5%)',
      calc_saving_label: 'Your estimated savings',

      // Agents
      agents_title:        'Our agents',
      agents_subtitle:     'Certified professionals on a fixed salary. They work for you, not for a cut.',
      agents_salary_badge: 'Fixed salary',

      // Sell page
      sell_title:    'Sell with Preos',
      sell_subtitle: "List your property on Spain's most transparent real estate platform.",

      // Footer
      footer_tagline:       "Spain's easiest property platform.",
      footer_rights:        '© 2026 Preos. All rights reserved.',
      footer_rent:          'Rent',
      footer_new_build:     'New builds',
      footer_commercial:    'Commercial',
      footer_about:         'About us',
      footer_agents_link:   'Agents',
      footer_blog:          'Blog',
      footer_contact:       'Contact',
      footer_privacy:       'Privacy',
      footer_terms:         'Terms of use',
      footer_cookies:       'Cookies',
      footer_legal_notice:  'Legal notice',
      home_recommended:     'Properties we recommend',

      // Buscar page
      buscar_results: 'results',
      buscar_in:      'in Málaga',

      // Property page
      prop_contact_agent: 'Contact agent',
      prop_book_visit:    'Schedule a visit',
      prop_tour_3d:       '3D Tour',

      // Misc
      recommended_title: 'Properties we recommend',

      // Footer headings
      footer_explore: 'EXPLORE',
      footer_company: 'COMPANY',
      footer_legal:   'LEGAL',

      search_placeholder:           'City, neighbourhood or address...',
      search_results_in:            'properties in',
      search_no_results_title:      'No properties found in',
      search_no_results_sub:        'Try a nearby city or broaden your search',
      search_all_properties:        'See all properties',
      search_cities_label:          'Cities',
      search_neighbourhoods_label:  'Neighbourhoods',
      search_properties_label:      'Properties',

      // Buscar filter bar
      filter_price:        'Price',
      filter_rooms:        'Rooms',
      filter_type:         'Property type',
      filter_more:         'More filters',
      filter_price_any:    'Any price',
      filter_price_to_200k:'Up to €200k',
      filter_price_200_400:'€200k – €400k',
      filter_price_400_700:'€400k – €700k',
      filter_price_700_1m: '€700k – €1M',
      filter_price_over_1m:'Over €1M',
      filter_rooms_any:    'Any number',
      filter_tipo_all:     'All',
      filter_tipo_piso:    'Apartment',
      filter_tipo_casa:    'House',
      filter_tipo_villa:   'Villa',
      filter_tipo_atico:   'Penthouse',
      filter_tipo_local:   'Commercial',
      sort_label:          'Sort by:',
      sort_recommended:    'Recommended',
      sort_price_asc:      'Price: low to high',
      sort_price_desc:     'Price: high to low',
      sort_newest:         'Newest',

      // Property card bilingual
      card_bedrooms:            'bed',
      card_bathrooms_singular:  'bath',
      card_bathrooms_plural:    'baths',
      card_new:                 'New',
      card_3d_tour:             '3D Tour',

      // Expanded filters
      filter_bathrooms:         'Bathrooms',
      filter_baths_any:         'Any number',
      filter_status:            'Status',
      filter_status_all:        'All',
      filter_status_nueva:      'New build',
      filter_status_resale:     'Resale',
      filter_status_bank:       'Bank repossession',
      filter_size:              'Size (m²)',
      filter_size_min:          'Minimum',
      filter_size_max:          'Maximum',
      filter_size_any:          'No limit',
      filter_features:          'Features',
      feat_pool:                'Pool',
      feat_garage:              'Garage',
      feat_garden:              'Garden',
      feat_terrace:             'Terrace',
      feat_elevator:            'Elevator',
      feat_ac:                  'Air conditioning',
      feat_sea_views:           'Sea views',
      feat_beachfront:          'Beachfront',
      feat_home_auto:           'Home automation',
      filter_year_built:        'Year built',
      filter_year_any:          'Any year',
      filter_year_before_2000:  'Before 2000',
      filter_year_2000_2010:    '2000–2010',
      filter_year_2010_2020:    '2010–2020',
      filter_year_after_2020:   'After 2020',
      filter_3d_tour:           'With 3D Tour',
      filter_apply:             'Apply filters',
      filter_clear:             'Clear',
      mobile_map_toggle_map:    'Map view',
      mobile_map_toggle_list:   'List view',

      bookingName:              'Full name',
      bookingPhone:             'Phone',
      bookingMessage:           'Message to agent (optional)',
      bookingConfirm:           'Confirm tour',
      bookingSuccess:           'A Preos agent will contact you within 2 hours.',
      bookingNameRequired:      'Please enter your name.',
      bookingPhoneRequired:     'Please enter your phone number.',
      moreDates:                'More available dates →',
      listed_by:                'Listed by',
      activity_days_on_preos:   'days on Preos',
      activity_views:           'views',
      activity_saves:           'saves',
      activity_tours:           'tours scheduled',
      popular_title:            'This home is popular',
      popular_desc:             "It's in the top 10% of views on Preos. Tour it before it's gone.",
      nav_overview:             'Overview',
      nav_neighborhood:         'Neighborhood',
      nav_details:              'Details',
      nav_history:              'History',
      nav_climate:              'Climate',
      market_insights_title:    'Market insights',
      market_type_balanced:     'Balanced market',
      insight_list_sale:        'Sale to list price',
      insight_days_market:      'Avg days on market',
      insight_competing:        'Competing offers',
      market_insights_coming:   'Market data coming soon',
      nb_loading:               'Loading neighborhood data...',
      nb_error:                 'Data unavailable',
      nb_source:                'Source: OpenStreetMap',
      nb_walkers_paradise:      "Walker's Paradise",
      nb_very_walkable:         'Very Walkable',
      nb_walkable:              'Walkable',
      nb_some_walk:             'Some Walkability',
      nb_car_dependent:         'Car-Dependent',
      nb_excellent_transit:     'Excellent Transit',
      nb_good_transit:          'Good Transit',
      nb_some_transit:          'Some Transit',
      nb_minimal_transit:       'Minimal Transit',
      nb_no_transit:            'No Transit',
      nb_bikers_paradise:       "Biker's Paradise",
      nb_very_bikeable:         'Very Bikeable',
      nb_bikeable:              'Bikeable',
      nb_some_bike:             'Some Bike Infra',
      nb_minimal_bike:          'Minimal Bike Infra',
      nb_quiet:                 'Quiet Area',
      nb_mostly_quiet:          'Mostly Quiet',
      nb_some_noise:            'Some Noise',
      nb_noisy:                 'Noisy',
      nb_very_noisy:            'Very Noisy',
      nb_wellness_paradise:     'Wellness Paradise',
      nb_healthy:               'Healthy Area',
      nb_some_wellness:         'Some Wellness',
      nb_limited_wellness:      'Limited Wellness',
      nb_tree_filled:           'Tree-Filled',
      nb_good_green:            'Good Green Space',
      nb_some_green:            'Some Green Space',
      nb_limited_green:         'Limited Green Space',
      catastro_title:           'Cadastral Reference',
      catastro_refcat:          'Reference',
      catastro_address:         'Official address',
      catastro_link:            'View Catastro record →',
      catastro_not_found:       'Not available',
      catastro_loading:         'Looking up Catastro...',
      catastro_address_match:   '✅ Address verified',
      catastro_address_mismatch:'⚠️ Address differs from official registry',
      catastro_confidence:      'Verification',
      cat_verified:             'Verified ✅',
      cat_high:                 'High confidence',
      cat_medium:               'Medium confidence',
      cat_low:                  'Needs review',
      cat_unverified:           'Unverified',
      cat_gps_only:             'GPS reference',
      places_schools:           'Schools',
      places_places:            'Places',
      places_transport:         'Transport',
      places_none_nearby:       'No data available',
      places_loading:           'Finding places...',
      climate_flood:            'Flood',
      climate_wildfire:         'Wildfire',
      climate_heat:             'Heat',
      climate_wind:             'Wind',
      climate_air:              'Air Quality',
      climate_very_low:         'Very Low',
      climate_low:              'Low',
      climate_medium:           'Moderate',
      climate_medium_high:      'Medium-High',
      climate_high:             'High',
      climate_very_high:        'Very High',
      climate_good:             'Good',
      climate_loading:          'Loading climate data...',
      climate_source:           'Source: ',
      climate_not_available:    'Not available',
      myVisits:                 'My visits',
      myProfile:                'My profile',
      upcomingVisits:           'Upcoming visits',
      pastVisits:               'Past visits',
      cancelVisit:              'Cancel visit',
      changeDate:               'Change date',
      noVisits:                 "You don't have any visits scheduled yet.",
      cancelConfirm:            'Are you sure you want to cancel this visit?',
      rescheduleBanner:         'You are rescheduling your visit.',
      statusPending:            'Pending',
      statusConfirmed:          'Confirmed',
      statusCompleted:          'Completed',
      statusCancelled:          'Cancelled',
      viewMyVisits:             'View my visits →',
      exploreProperties:        'Explore properties',

      // Vender / agent search flow
      sellHeroTitle:            'Sell your property with the perfect agent',
      sellSearchPlaceholder:    'Which area do you want to sell in? (e.g. Marbella)',
      agentsIn:                 'Agents in',
      agentsSince:              'Preos Agent since',
      propertiesSold:           'properties sold',
      avgDays:                  'avg. days to sell',
      requestValuation:         'Request free valuation',
      propertyAddress:          'Property address (optional)',
      aboutMe:                  'About me',
      contactAgent:             'Contact',
      respondTime:              'Responds within 2 hours',

      // Offer flow
      myOffers:                 'My offers',
      startOffer:               'Start an offer',
      offerPrice:               'Offer price',
      askingPrice:              'Asking price',
      arrasAmount:              'Deposit amount',
      arrasDate:                'Deposit date',
      closingDate:              'Closing date',
      coverLetter:              'Cover letter',
      offerSent:                'Offer sent',
      offerPending:             'Pending',
      offerAccepted:            'Accepted',
      offerCountered:           'Countered',
      offerRejected:            'Rejected',
      offerWithdrawn:           'Withdrawn',
      withdrawOffer:            'Withdraw offer',
      withdrawConfirm:          'Are you sure you want to withdraw this offer?',
      noOffers:                 'You have no active offers',
      hasMortgage:              'I have mortgage approval',
      cashBuyer:                'Cash buyer',

      // Offer wizard
      offerStep1Title:      'Offer price',
      offerStep1Sub:        'How much would you like to offer for this property?',
      offerAskingRef:       'Asking price:',
      offerEqualAsking:     'Equal to asking price',
      offerAboveAsking:     'above asking price',
      offerBelowAsking:     'below asking price',
      offerExactLabel:      'Or enter an exact amount',
      offerPriceError:      'Please enter a valid price.',
      offerStep2Title:      'Your buyer profile',
      offerStep2Sub:        'Help the seller understand your position.',
      offerCashLabel:       'Cash buyer',
      offerCashSub:         'No mortgage financing needed',
      offerMortgLabel:      'Mortgage pre-approval',
      offerMortgSub:        'I have a bank pre-approved mortgage',
      offerStep3Title:      'Deposit & timeline',
      offerStep3Sub:        'Set the financial terms and timeline for your offer.',
      arrasOf:              'deposit',
      arrasCalculating:     'Calculating…',
      arrasEqualRec:        'Equal to the recommended 10%',
      arrasAboveRec:        'points above the recommended 10%',
      arrasBelowRec:        'points below the recommended 10%',
      arrasHint:            '💡 10% of the offer price is standard in Spain',
      arrasDateLabel:       'Deposit signing date',
      closingDateLabel:     'Estimated closing date (deed)',
      arrasDateHint:        '💡 Minimum 7 days — we recommend at least 2 weeks to prepare documentation',
      closingDateHint:      '💡 Minimum 30 days from deposit — we recommend 45–60 days for mortgage and notary',
      offerStep4Title:      'Cover letter',
      offerStep4Sub:        "Optional — tell the seller why you're the ideal buyer.",
      coverLetterLabel:     'Your message to the seller',
      coverLetterPh:        "Hi, we're a family looking for our first home in Marbella…",
      conditionsLabel:      'Additional conditions (optional)',
      conditionsPh:         'Subject to building technical inspection…',
      offerStep5Title:      'Confirm your offer',
      offerStep5Sub:        'Review the details before submitting. You can withdraw from',
      summaryProperty:      'Property',
      summaryBuyerStatus:   'Buyer profile',
      summaryArras:         'Deposit',
      summaryArrasDate:     'Deposit date',
      summaryClosingDate:   'Closing date',
      summaryCash:          'Cash buyer',
      summaryMortgApproved: 'Mortgage approved',
      summaryFinancingTBD:  'Financing pending',
      summaryConditions:    'Additional conditions',
      summaryCoverLetter:   'Cover letter',
      summaryNoLetter:      'No cover letter',
      notSpecified:         'Not specified',
      btnBack:              '← Back',
      btnNext:              'Next →',
      btnReviewOffer:       'Review offer →',
      btnEditOffer:         '← Edit',
      btnSubmitOffer:       'Submit offer',
      btnSubmitting:        'Submitting…',
      btnGoBack:            '← Back',
      offerSuccessTitle:    'Offer submitted!',
      offerSuccessSub:      "Your offer has been sent to the agent. We'll notify you of any updates.",
      btnViewMyOffers:      'View my offers',
      btnKeepBrowsing:      'Keep browsing',
      propNotFound:         'Property not found.',
      offerAuthTitle:       'Sign in to continue',
      offerAuthSub:         'You need a Preos account to submit an offer.',
      offerBreadcrumb:      'Start offer',
      offerMarketPrice:     'Avg. price in',
      offerMarketSrc:       'Source: Notariado',
      offerSubmitError:     'Error submitting your offer. Please try again.',
      // Offer cards (mis-ofertas.html)
      offerSentOn:          'Submitted on',
      offerStatusSent:      'Submitted',
      offerAcceptedMsg:     'Your offer has been accepted! The agent will be in touch with you soon.',
      offerCounteredMsg:    'The agent has sent a counteroffer. Contact Preos to continue the negotiation.',
      offerViewProp:        'View property →',
      offerCondLabel:       'Conditions:',
      offerDetailCash:      'Cash',
      offerDetailMortgage:  'Mortgage approved',
      offerDetailArras:     'Deposit:',
      offerDetailArrasDate: 'Deposit date:',
      offerDetailClosing:   'Closing:',
      offerEmptyTitle:      'No active offers',
      offerEmptySub:        'When you submit an offer on a property, it will appear here.',
      offerBrowseProps:     'Browse properties',
      withdrawModalTitle:   'Withdraw offer?',
      withdrawModalSub:     'This action cannot be undone.',
      btnCancel:            'Cancel',
      btnWithdrawConfirm:   'Withdraw',
      // Agent CRM (agente-dashboard.html)
      crmTitle:             'Agent CRM',
      crmNewLeads:          'New leads',
      crmAllLeads:          'All leads',
      crmProperties:        'Properties',
      crmPropertiesSubtitle:'Properties with lead activity',
      crmSellLeads:         'Sell leads',
      crmSellLeadsSubtitle: 'Valuation requests received',
      crmOffers:            'Offers',
      crmLeadsPending:      'leads pending review',
      crmOffersPending:     'offers received',
      crmLabelNotes:        'Notes',
      crmNotesPh:           'Notes about this lead…',
      crmBtnCall:           'Call',
      crmBtnWhatsApp:       'WhatsApp',
      crmBtnViewProp:       'View property',
      crmPipelineNew:       'New',
      crmPipelineContacted: 'Contacted',
      crmPipelineVisit:     'Visit scheduled',
      crmPipelineOffer:     'Offer submitted',
      crmPipelineClosed:    'Closed',
      crmDaysAgo:           '',
      crmDaysAgoSuffix:     'days ago',
      crmNoLeads:           'No leads in this section.',
      crmOfferSendTitle:    'Send offer to seller',
      crmOfferAgentNote:    'Additional note for the selling agent (optional):',
      crmOfferAgentNotePh:  'Add any additional notes before sending…',
      crmOfferNoAgent:      'Selling agent not yet identified — available when MLS (Resales Online) is integrated',
      crmBtnCopyOffer:      'Copy offer',
      crmBtnEmailOffer:     'Send by email',
      crmBtnWhatsAppOffer:  'Send via WhatsApp',
      crmOfferCopied:       '✅ Offer copied to clipboard',
      crmCopyError:         '❌ Copy failed',
      crmLabelAskingPrice:  'Asking price',
      crmLabelOffer:        'Offer',
      crmLabelArras:        'Deposit',
      crmLabelArrasDate:    'Deposit date',
      crmLabelClosing:      'Closing date',
      crmLabelConditions:   'Conditions',
      crmLabelCoverLetter:  'Cover letter',
      crmOfferStatusNew:    'New',
      crmOfferStatusReviewed:'Reviewed',
      crmOfferStatusForwarded:'Sent to seller',
      crmOfferStatusAccepted:'Accepted',
      crmOfferStatusRejected:'Rejected',
      crmInternalNotesPh:   'Internal notes…',
      crmLabelName:         'Name',
      crmLabelEmail:        'Email',
      crmLabelPhone:        'Phone',
      crmLabelVisitDate:    'Visit date',
      crmLabelProperty:     'Property',
      crmLabelPipeline:     'Pipeline',
      crmOfferCardHeader:   'PROPERTY / SELLING AGENT',
      crmOfferTerms:        'OFFER TERMS',
      crmCondicionesHeader: 'ADDITIONAL CONDITIONS',
      crmCartaHeader:       'COVER LETTER',
      crmSendOfferTitle:    'SEND OFFER TO SELLER',

      // Listing Quality
      lqPremium:            'Premium',
      lqCompleto:           'Complete',
      lqLimitado:           'Limited',
      lqIncompleto:         'Incomplete',
      lqScore:              'Quality score',
      lqImages:             'photos',
      lqFeatures:           'features',
      lqYes:                'Yes',
      lqNo:                 'No',
      lqMissing:            'Not available',
      lqAnalyzing:          'Analysing quality…',
      lqCheckImgCount:      'Photo count',
      lqCheckResolution:    'Resolution',
      lqCheckOrientation:   'Orientation',
      lqCheckDescription:   'Description',
      lqCheckFeatures:      'Features',
      lqCheck3DTour:        '3D tour',
      lqCheckLocation:      'GPS coordinates',
      lqCheckYearBuilt:     'Year built',
      lqResNoImages:        'No photos loaded',
      lqOrientAllLandscape: 'All landscape',
      lqOrientHasPortrait:  'Has portrait(s)',
      lqOrientMixed:        'Mixed',
      lqQualityTab:         'Listing quality',
      lqSortByQuality:      'By quality',

      // Backward-compat dotted keys
      'nav.comprar':        'Buy',
      'nav.vender':         'Sell',
      'nav.agentes':        'Real Estate Agents',
      'nav.micuenta':       'My account',
      'nav.ingresar':       'Sign in',
      'hero.title':         'The easiest way to buy a property, is with Preos',
      'hero.search':        'Search by city, address or postal code',
      'hero.comprar':       'Buy',
      'hero.vender':        'Sell',
      'recommended.title':  'Properties we recommend',
      'footer.explorar':    'EXPLORE',
      'footer.empresa':     'COMPANY',
      'footer.legal':       'LEGAL',
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     State
  ──────────────────────────────────────────────────────────────────── */
  var _lang = 'es';

  /* ─────────────────────────────────────────────────────────────────
     Language detection
  ──────────────────────────────────────────────────────────────────── */
  function detectLang() {
    // 1. localStorage
    var stored = localStorage.getItem('preos-lang');
    if (stored === 'en' || stored === 'es') return stored;

    // Also check the old key used by translations.js for backwards compat
    var storedOld = localStorage.getItem('preos_lang');
    if (storedOld === 'en' || storedOld === 'es') return storedOld;

    // 2. Browser language
    var nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';

    // 3. Default
    return 'es';
  }

  /* ─────────────────────────────────────────────────────────────────
     Render — apply translations to the current DOM
  ──────────────────────────────────────────────────────────────────── */
  function render(lang) {
    var t = strings[lang] || strings.es;

    // <html lang>
    document.documentElement.lang = lang;

    // data-i18n text nodes
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key] !== undefined) el.textContent = t[key];
    });

    // data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (t[key] !== undefined) el.placeholder = t[key];
    });

    // Nav links — matched by href so no data-i18n needed on every page
    document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('buscar') !== -1) { a.textContent = t.nav_buy;    return; }
      if (href.indexOf('vender') !== -1) { a.textContent = t.nav_sell;   return; }
      if (href.indexOf('agentes') !== -1){ a.textContent = t.nav_agents; return; }
    });

    // #nav-ingresar-btn
    var ingresarBtn = document.getElementById('nav-ingresar-btn');
    if (ingresarBtn) ingresarBtn.textContent = t.nav_signin;

    // #nav-mi-cuenta — only update if it's the logged-out plain link
    var miCuenta = document.getElementById('nav-mi-cuenta');
    if (miCuenta) {
      var mcLink = miCuenta.tagName === 'A' ? miCuenta : miCuenta.querySelector('a:not([href="dashboard.html"])');
      // only touch the simple "Mi cuenta" link, not the auth dropdown
      if (mcLink && !miCuenta.querySelector('.auth-user-btn')) {
        mcLink.textContent = t.nav_myaccount;
      }
    }

    // Lang toggle appearance
    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      el.innerHTML = lang === 'en'
        ? '<strong>EN</strong>&nbsp;|&nbsp;<span style="opacity:.45;font-weight:500">ES</span>'
        : '<strong>ES</strong>&nbsp;|&nbsp;<span style="opacity:.45;font-weight:500">EN</span>';
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     Public API
  ──────────────────────────────────────────────────────────────────── */

  /** Translate a single key in the current language. */
  function t(key) {
    var dict = strings[_lang] || strings.es;
    return dict[key] !== undefined ? dict[key] : key;
  }

  /** Switch language, persist, and re-render the page. */
  function setLang(lang) {
    if (lang !== 'en' && lang !== 'es') return;
    _lang = lang;
    localStorage.setItem('preos-lang', lang);
    localStorage.setItem('preos_lang', lang); // keep old key in sync
    render(lang);
    document.dispatchEvent(new CustomEvent('preos:langchange', { detail: { lang: lang } }));
    if (window.PreosAnalytics) PreosAnalytics.trackLanguageSwitch(lang);
  }

  /** Detect language, render, and wire toggle click handlers.
   *  Idempotent — safe to call multiple times. */
  function init() {
    _lang = detectLang();
    render(_lang);

    document.querySelectorAll('.lang-toggle').forEach(function (el) {
      // Remove any existing listener by cloning (prevents double-binding)
      var fresh = el.cloneNode(true);
      el.parentNode.replaceChild(fresh, el);
      fresh.addEventListener('click', function () {
        setLang(_lang === 'es' ? 'en' : 'es');
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     Auto-init on DOMContentLoaded
  ──────────────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init: init, setLang: setLang, t: t, strings: strings };

})();

/** Convenience global so inline onclick="setLang('en')" works. */
window.setLang = function (lang) { window.PreosLang.setLang(lang); };
