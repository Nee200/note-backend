const RAW_SUPPLIER_LIST = `
M1 D&G The One
M2 Terre D´Hermés
M3 Jean Paul Gaultier 2
M4 Dior Homme Intense
M5 Armani Code
M6 Armani Acqua di Gio
M7 Boss Bottled
M8 Boss Orange
M9 Nikos Sculpture
M10 Rochas
M11 D&G Homme
M12 Gucci Guilty
M13 Gucci Envy
M14 Gucci II
M15 Paco Rabanne One Million
M16 V&R Spicebomb
M17 Dior Homme Sport
M18 Dior Fahrenheit 32
M19 Dior Fahrenheit
M20 Issey Miake
M21 CH 212 VIP
M22 Chanel Allure Sport
M23 CK One
M24 Givenchy Pi
M25 TM Amen
M26 CH 212
M27 LB Roma
M28 Kenzo
M29 YSL La´Nuit
M30 Chanel Bleu
M31 Dior Homme
M32 JPG Le Male
M33 Diesel Only The Brave
M34 PR One Million Elexier
M35 CH 212 Sexy Men
M36 Xerjoff Erba Gold
M37 Paco Rabanne Invictus
M38 Paco Rabanne Ultraviolette
M39 Tom Ford Tuscan Leather
M40 Joop! Homme
M41 Creed Aventus
M42 Cartier Decleration
M43 Jil Sander Sun Men
M44 Golden Dust
M45 BLV Man in Black
M46 BLV Aqua
M47 Dior Sauvage
M48 T.F. Tobacco Vanille
M49 Boss Scent
M50 Silver Dust
M51 Valentino Uomo
M52 Ted Lapidus
M53 Mr Burberry Indigo
M54 Dunhill Fresh (Blue)
M55 Boss Bottled Oud
M56 MFK Baccarat Rouge 540
M57 MFK Oud Satin Mood
M58 Aqua di Parma Oud Colonia
M59 Azzaro Wanted
M60 Calvin Klein Eternity Men
M61 Versace Eros
M62 Armani Code Profumo
M63 YSL Kuros
M64 Prada Luna Rossa Extreme
M65 Thierry Mugler Alien Men
M66 Amouage Reflection
M67 Black Afghano
M68 Joop Homme Wild
M69 Paco Rabanne Black XS
M70 Atkinson Oud Save the King
M71 Chanel Egoist Platinum
M72 Tom Ford Extreme Noir
M73 Armani He
M74 Armani Acqua di Gio Profumo
M75 Gucci by Gucci
M76 Davidoff Coolwater
M77 Tom Ford Oud Wood
M78 Tom Ford Noir de Noir
M79 Molecules Escentric 02
M80 Molecules Escentric 01
M81 Diesel Fuel for Life Spirit
M82 Kilian Bambo Harmony
M83 Dior Prive Ambre Nuit
M84 YSL La Nuit Intense
M85 Jpg Ultra Male
M86 Joop Wow
M87 Armani Stronger with you
M88 Dior Homme Cologne
M89 Valentino Uomo Intense
M90 Paco Rabanne One Million Prive
M91 Guerlain Ideal L´Homme EDP
M92 Prada Milano L´Homme
M93 Boss Bottled Night
M94 Tom Ford Fucking Fabulous
M95 Orlane Derreck
M96 Diesel Fuel for Life
M97 Versace Oud Noir
M98 Nautica Voyage
M99 Aramis
M100 Paco Rabanne One Million Lucky
M101 Dunhill Desire Red
M102 Christian Clive No.1
M103 Hugo Boss Hugo
M104 Lacoste Red
M105 Lacoste Eau de Lacoste L. 12. 12 Blanc
M106 Jacques Bogart Silver Scent
M107 Amouage Bracken
M108 Giorgo Armani Myrrhe Imperial
M109 Giorgo Armani Cuir Noir
M110 Tom Ford Ombre Leather
M111 Tom Ford Lost Cherry
M112 Amouage Interlude
M113 Chopard Oud Malaki
M114 Drakkar Noir
M115 Creed Silver Mountain Water
M116 Creed Green Irish Tweed
M117 Diesel Spirit of the Brave
M118 Azzaro Pour Homme
M119 Al Wisam Rasai
M120 Tom Ford Neroli Portofino
M121 Armani You Intensly
M122 Burberry London
M123 Montale Mukhallat
M124 Tom Ford Oud Minerale
M125 Shay Oud
M126 Mancera Red Tobacco
M127 Hugo Boss Energise
M128 Prada Luna Rossa
M129 Hugo Boss Extreme
M130 Azzaro Chrome
M131 Byredo Oud Immortel
M132 Montale Kabul Aoud
M133 Widian Liwa
M134 Thameen Patiala
M135 Tom Ford Patchouli Absolu
M136 Memo Paris Marfa
M137 Louis Vuitton Ombre Nomade
M138 Louis Vuitton L\`Immensite
M139 Louis Vuitton Les Sables Rose
M140 Dior Rouge Trafalgar
M141 YSL Y
M142 Ard Al Khaleej Ghalah Zayed
M143 Ard Al Zaafaran Dirham
M144 Ard Al Zaafaran Oud Romance
M145 Lattafa Sheik Al Shuyukh
M146 Dolce & Gabbana
M147 Thierry Mugler Alien Mirage
M148 Tom Ford Beau de Jour
M149 Arabian Oud Madawi
M150 Montale Black Oud
M151 Montale Intense Cafe
M152 Zadig & Voltaire This is Him
M153 Parfum de Marly Leyton
M154 Chopard Black Incense Malaki
M155 Abdul Samad Al Qurashi Rannat Khilkhal
M156 Lattfa Ana Abiyedh
M157 Creed Viking
M158 Roja Amber Aoud
M159 Tiziana Terenzi Kirke
M160 Xerjoff Erba Pura
M161 JPG Le Male Le Parfum
M162 Franck Olivier Oud Touch
M163 MFK L´Homme a La Rose
M164 Gisada Ambassador
M165 Fendi Life Esseeence
M166 Dior Oud Ispahan
M167 Prada Luna Rossa Black
M168 Montal Honey Aoud
M169 Montale Choclate Greedy
M170 Louis Vuitton Cactus Garden
M171 Paco Rabanne Invictus Victory
M172 JPG Scandal
M173 Tom Ford Bitter Peach
M174 Montale Arabians Tonka
M175 Prada Luna Rossa Sport
M176 MFK Grand Soir
M177 MFK Gentle Fuluidity Silver
M178 Franco Ferre
M179 Paco Rabanne Phantom
M180 Xerjoff Naxos
M181 Xerjoff Alexandria 3
M182 Initio Oud 4 Greatness
M183 Dior Bois a´Argent
M184 Louis Vuitton Afternoon Swim
M185 Ajmal Wisal
M186 White Sandal
M187 Dior Sauvage Elixir
M188 Kilian Don´t be Shy
M189 Kilian Angels Share
M190 Azzaro the Most Wanted
M191 Xerjoff Casamorati Bouquet Ideale
M192 Xerjoff Mefisto
M193 Xerjoff Casamorati Lira
M194 Xerjoff Richwood
M195 Xerjoff 1861 Renaissance
M196 Xerjoff Alexandria 2
M197 Armani Acqua Dio Gio Absolu
M198 Aramni Acqua Dio Gio Essenza
M199 Tom Ford Mandarino di Amalfi
M200 Valentino Born in Roma
M201 Xerjoff Acento
M202 Xerjoff Join The Club 40 Knots
M203 Xerjoff Gran Ballo
M204 Amouage Imitation
M205 Frederic Malle Musc Ravageur
M206 Initio Musk Therapy
M207 Tiziana Terenzi Spirito Fiorentino
M208 Montale Intense Cherry
M209 Tom Ford Soleil Blanc
M210 Parfum de Marly Pegasus
M211 Mancera Coco Vanille
M212 Aramis 900
M213 Armani Stronger with You Only
M214 Hummer
M215 Xerjoff Luxor
M216 Tiziana Terenzi Orza
M217 Salvatore Ferragamo Intense Leather
M218 Paco Rabanne Black XS L'exces
M219 Amir Al Oud
M220 Widian Black II
M221 Widian Black IV
M222 Widian Black V
M223 Widian Limited 71 Intense
M224 Louis Vuitton Pure Oud
M225 Louis Vuitton Nuit de Feu
M226 Louis Vuitton Spell on You
M227 Montale Sensual Instinct
M228 Gucci Intense Oud
M229 Killian Apple Brandy on the Rocks
M230 Cartier Pasha
M231 Nishane Hacivat
M232 Orto Parisi Megamre
M233 Nishane Ani
M234 Diesel Bad
M235 Givenchy Gentleman
M236 Xerjoff Casamorati 1888 Italica
M237 Xerjoff Nio
M238 Paco Rabbane Invictus Platinum
M239 Montale Ristretto Intense Cafe
M240 Armani Stronger with You Oud
M241 Baccarat Rouge 540 Extrait de Parfum
M242 Louis Vouitton Meteore
M243 Bois 1920 Canabis
M244 Mancera Roses Vanille
M245 Guerlain Spiritieuse Double Vanille
M246 Armani Code Parfum
M247 Dior Vanilla Diorama
M248 Jacques Bogart One Man Show
M249 Malizia Uomo Vetyver Green
M250 Tom Ford Costa Azzurra
M251 Roja Dove Oligarch
M252 Initio Side Effect
M253 Parfum De Marly Herod
M254 Rasasi Junoon Satin
M255 Louis Vuitton Imagination
M256 Armani Prive Royal Oud
M257 Xerjoff More Than Words
M258 Al Jaezeera Magic
M259 Initio Paragon
M260 Xerjoff Muse
M261 Sospiro Contralto
M262 Sospiro Vibrato
M263 Tom Ford Smoke Cherry
M264 Tom Ford Electric Cherry
M265 Paco Rabbane One Million Royale
M266 Dolce & Gabbana Light Blue
M267 Jo Malone London Myyrh & Tonka
M268 Prada Luna Rossa Ocean
M269 Xerjoff Laylati
M270 Xerjoff Torino 22
M271 Acqua Di Parma Fico di Amalfi
M272 Kajal Almaz
M273 Gisah Hudson Valley
M274 Boss The Collection Magnetic Musk
M275 Jean Paul Gaultier Le Beau
M276 Jean Paul Gaultier Le Male Elixier
M277 Mancera Tonka Cola
M278 Viktor Rolf Spicebomb Extreme
M279 Bulgari Bvlgari Le Gemme Tygar
M280 Caronlina Herrera Bad Boy
M281 Louis Vuitton Orage
M282 Louis Vuitton Fleur du Desert
M283 Tom Ford Cafe Rose
M284 YSL La Nuit Le Parfum
M285 Clive Christian Magnolia Rococo VIII
M286 Xerjoff Tony Lommi Monkey Special
M287 YSL Myslf
M288 KayAli Vanilla 28
M289 KayAli Yum Pistachio Gelato 33
M290 Creed Aventus Absolu
M291 Mancera Instant Crush
M292 Montale Infinity
M293 Parfum De Marly Althair
M294 Boss Bottled Elixier
M295 Tom Ford Myrrhe Mystere
M296 Montale Vanille Absolu
M297 Tom Ford Vanilla Sex
M298 Louis Vuitton California Dream
M299 Zarko Perfume The Muse
M300 Louis Vuitton Pacific Chill
M301 Armani Stronger with You Absolutely
M302 Collection Prestige Sultan No. 9
M303 Xerjoff Torino 21
M304 YSL Supreme Bouqeut
M305 Acqua Di Parma Mandorlo di Sicilia
M306 Louis Vuitton City of Stars
M307 Montblanc Explorer
M308 Kilian Don't be Shy Extreme
M309 Louis Vuitton Lovers
M310 Louis Vuitton Symphony
M311 Vertus Sole Patchouli
M312 Jean Paul Gaultier Paradise Garden
M313 Killian Good Girl Gone Bad
M314 Burberry Hero
M315 Maison Crivelli Oud Maracuja
M316 YSL Tuxedo
M317 Stephane Humbert Lucas God Of Fire
M318 Widian London
M319 Le Labo Santal 33
M320 Marc-Antonie Barrois Ganymende
M321 Clive Christian Blonde Amber
M322 Parfums De Marly Greenly
M323 Maison Crivelli Hibiscus Mahajad
M324 Kilian Black Phantom
M325 Acqua Di Parma Mandarino Di Sicilia
M326 MFK 724
M327 Louis Vuitton Sun Song
M328 Parfums De Marly Castley
M329 Xerjoff Coro
M330 Parfums De Marly Oajan
M331 Ex Nihilo Blue Talisman
M332 Parfums De Marly Haltana
W1 Escada Magnetisim
W2 Dior Hypnotic Poison
W3 Prada Candy
W4 Dolce & Gabbana The One
W5 Paco Rabbane Lady Million
W6 Chloe
W7 Viktor Rolf Flowerbomb
W8 YSL Manifesto
W9
W10 YSL Black Opium
W11 Thierry Mugler Alien
W12 Thierry Mugler Angel
W13 Chanel No. 5
W14 Chanel Coco Madmoiselle
W15 Chanel Chance Eau Fraiche
W16 Lancome La vie este Belle
W17 Dior Jadore
W18 Dior Miss Dior
W19 Dior Addict
W20 Kenzo Flower
W21 Tom Ford Black Orchid
W22 Calvin Klein Eternity
W23 Versace Bright Crystal
W24 Issey Miyake L eau d Issey
W25 Jean Paul Gaultier Classique
W26 Carolina Herrera 212 VIP
W27 Hugo Boss pour Femme
W28 Armani Code
W29 Lacoste pour Femme
W30 Bubble Gum
W31 Bon Bon Vanille
W32 Valentino Donna
W33 Viktor Rolf Bonbon
W34 Dolce & Gabbana Light Blue
W35 Gucci Rush
W36 Gucci Guilty Intense pour Femme
W37 Boss Mavie
W38 Armani Si
W39 Chanel Chance Eau Tendre
W40 Armani Si Passion
W41 Lattafa Ser Al Shulod Dubai
W42 Jean Paul Gaultier La Belle
W43 Boss Alive
W44 Jil Sander Sun
W45 Michael Kors Sexy Amber
W46 Burberry London
W47 Boss Orange
W48 Dior Poison Girl
W49 DKNY Be Delicious (Green)
W50 Paco Rabbane Olympea
W51 Calvin Klein Euphoria
W52 Bulgari Omnia Crystalline
W53 Lancome Tresor
W54 Lancome Miracle
W55 Lancome Hypnose
W56 Marc Jacobs Decadence
W57 Narciso Rodriguez For Her
W58 Boss The Scent
W59 Gucci Bamboo
W60 Versace Cristall Noir
W61 YSL Opium
W62 Guerlain L'instant Magic
W63 Armani Acqua di Gioia
W64 Dolce & Gabbana No 3
W65 Lancome Midnight Rose
W66 Lancome Tresor La Nuit
W67 YSL Mon Paris
W68 Roberto Cavalli EDP
W69 Elie Saab Le Parfume
W70 Zuckerwatte
W71 Bottega Veneta Femme
W72 Escada Sexy Graffiti
W73 Cacharel Amor Amor
W74 Jean Paul Gaultier Scandal
W75 Victoria Secret Bombshell
W76 Joop Le Bain
W77 Chanel Gabrielle
W78 Escada Especially
W79 Mon Guerlain
W80 Molecules 01
W81 Jean Paul Gaulter So Scandal
W82 Kilian Bamboo Harmony
W83 Prada Infusion D'iris
W84 Chanel Coco eau de Parfum
W85 Marc Jacobs Daisy
W86 Prada Milano Femme
W87 Carolina Herrera Good Girl
W88 Milton Llyod Hawaii
W89 Gucci by Gucci
W90 Thierry Mugler Aura
W91 Diesel Fuel for Life
W92 Givenchy Amarige
W93 Kilian Black to Black
W94 Montale Sweet Vanilla
W95 Giorgio Armani Myrrhe Imperiale
W96 Giorgio Armani Cuir Noir
W97 Yves Magnolia
W98 Paco Rabbane Black XS Pure
W99 Chanel Coco Madmoiselle intense
W100 Paco Rabbane Lady Million Lucky
W101 Victor Rolf Flowerbomb La vie en Rose
W102 Gucci Guilty Absolute
W103 Gucci Flora Gardenia
W104 Carolina Herrera 212 Sexy
W105 Roberto Cavalli Just Cavalli
W106 Armani Because its You
W107 Givenchy L'interdit
W108 Gucci Bloom
W109 Lancome Idole
W110 YSL Libre
W111 Ajmal 1001 Nights
W112 Chloe Nomade
W113 Kalemat Arabian Oud
W114 Chloe Love
W115 Dolce & Gabbana Garden
W116 Burberry Her
W117 Dior Poison (Cobra)
W118 Armani My Way
W119 Zadig & Voltaire This is Her
W120 YSL Libre Intense
W121 Xerjoff Opera
W122 Chanel Madmoiselle L'eau Prive
W123 Louis Vuitton Rose des Vents
W124 Montale Rose Musk
W125 Afnan Zahrat Al Khaleej
W126 Chanel Chance Eau de Parfum
W127 Ana Wel Shook
W128 Paris Hilton
W129 Xerjoff Casamorati Dama Bianca
W130 Parfum De Marly Delina
W131 Valentino Born in Roma
W132 Gisada Ambassadora
W133 Xerjoff Acento
W134 Kilian Dont be Shy
W135 Kilian Angels Share
W136 Baccarat Rouge 540 Eau de Parfum
W137 Dior Rouge Trafalgar
W138 Xerjoff Erba Pura
W139 Armani Emporio She
W140 Priscilla Presley Indian Summer
W141 Tom Ford Soleil Blanc
W142 Mancera Coco Vanille
W143 Lancome La Nuit Tresor Intense
W144 Armani My Way Floral
W145 Creed Wind Flowers Floral
W146 Louis Vuitton Spell on You
W147 Creed Aventus For Her
W148 Gucci Flora Gorgeous Gardenia
W149 Montale Sensual Instinct
W150 Widian Black II
W151 Widian Black IV
W152 Widian Black V
W153 Widian Black Limited 71 Intense
W154 Tulip
W155 Yasmin
W156 Carolina Herrera Very Good Girl Glam
W157 Montale White Musk
W158 Britney Spears Fantasy
W159 Tom Ford Velvet Orchid
W160 Jean Paul Gaultier Scandal Le Parfum
W161 Prada Paradox
W162 Paco Rabbane Fame
W163 Davidoff Cool Water
W164 YSL Libre Le Parfum
W165 Armani Code Cashmere
W166 Dior Vanill Diorama
W167 Mancera Roses Vanille
W168 Baccarat Rouge 540 Extrait de Parfum
W169 YSL Cinema
W170 Tom Ford Cost Azzurra
W171 Initio Side Effect
W172 Xerjoff Coro
W173 Rasasi Junoon Satin
W174 Xerjoff More Than Words
W175 Montale Intense Tiare
W176 Narciso Rodriguez For Her Black
W177 Bulgari Bvlgari Le Gemme Tygar
W178 Burberry Goddes
W179 Tom Ford Cafe Rose
W180 Louis Vuitton Fleur du Desert
W181 KayAli Vanilla 28
W182 KayAli Pistachio Gelato 33
W183 Hareem Al Sultan Gold Khadlaj
W184 Mancera Instant Crush
W185 Montale Infinity
W186 Lv Coeuer Battant
W187 Dolce & Gabbana Devotion
W188 Montale Vanilla Absolu
W189 Tom Ford Vanilla Sex
W190 Dior Miss Dior Rose
W191 YSL Supreme Bouquet
W192 Louis Vuitton City of Stars
W193 Louis Vuitton Symohony
W194 Jean Paul Gaultier Divine
W195 Kilian Good Girl Gone Bad
W196 Parfum De Marly Valaya
W197 Givenchy L'interdit Angelique Rouge
W198 Carolina Herrera La Bomba
W199 Parfums De Marly Palatine
W200 Prada Paradox Intense
W201 Parfums De Marly Valaya Exclusif
W202 YSL Libre Vanille Couture
`;

function normalizeComparableText(value) {
    const commonFixes = [
        [/[\u2018\u2019\u00b4`']/g, ''],
        [/&/g, ' and '],
        [/\bparfume\b/g, 'parfum'],
        [/\brabbane\b/g, 'rabanne'],
        [/\barmani\b/g, 'armani'],
        [/\baramni\b/g, 'armani'],
        [/\bgiorgo\b/g, 'giorgio'],
        [/\bgaulter\b/g, 'gaultier'],
        [/\bmadmoiselle\b/g, 'mademoiselle'],
        [/\bcost azzurra\b/g, 'costa azzurra'],
        [/\bvanill\b/g, 'vanilla'],
        [/\bcoeuer\b/g, 'coeur'],
        [/\bvouitton\b/g, 'vuitton'],
        [/\bsymohony\b/g, 'symphony'],
        [/\belexier\b/g, 'elixir'],
        [/\bfuluidity\b/g, 'fluidity'],
        [/\bchoclate\b/g, 'chocolate'],
        [/\bmyyrh\b/g, 'myrrh'],
        [/\bmyslf\b/g, 'myself'],
        [/\bgoddes\b/g, 'goddess'],
        [/\besseeence\b/g, 'essence'],
        [/\bintensly\b/g, 'intensely']
    ];

    let normalized = String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    commonFixes.forEach(([pattern, replacement]) => {
        normalized = normalized.replace(pattern, replacement);
    });

    normalized = normalized
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized;
}

function toBigramSet(value) {
    const compact = String(value || '').replace(/\s+/g, '');
    if (!compact) return new Set();
    if (compact.length === 1) return new Set([compact]);
    const set = new Set();
    for (let i = 0; i < compact.length - 1; i += 1) {
        set.add(compact.slice(i, i + 2));
    }
    return set;
}

function diceCoefficient(a, b) {
    const setA = toBigramSet(a);
    const setB = toBigramSet(b);
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    setA.forEach((item) => {
        if (setB.has(item)) intersection += 1;
    });
    return (2 * intersection) / (setA.size + setB.size);
}

function tokenJaccard(a, b) {
    const setA = new Set(String(a || '').split(' ').filter(Boolean));
    const setB = new Set(String(b || '').split(' ').filter(Boolean));
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    setA.forEach((item) => {
        if (setB.has(item)) intersection += 1;
    });
    const union = setA.size + setB.size - intersection;
    return union > 0 ? (intersection / union) : 0;
}

function similarityScore(a, b) {
    const normA = normalizeComparableText(a);
    const normB = normalizeComparableText(b);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    const dice = diceCoefficient(normA, normB);
    const jaccard = tokenJaccard(normA, normB);
    let score = (dice * 0.65) + (jaccard * 0.35);

    if (normA.includes(normB) || normB.includes(normA)) {
        score += 0.08;
    }

    return Math.min(1, score);
}

function parseSupplierList(raw) {
    const entries = [];
    String(raw || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .forEach((line) => {
            const match = line.match(/^([MW])(\d{1,4})\s*(.*)$/i);
            if (!match) return;
            const prefix = match[1].toUpperCase();
            const number = parseInt(match[2], 10);
            const inspiredBy = String(match[3] || '').trim();
            entries.push({
                supplierId: `${prefix}${number}`,
                prefix,
                number,
                inspiredBy,
                normalizedInspiredBy: normalizeComparableText(inspiredBy)
            });
        });
    return entries;
}

const supplierEntries = parseSupplierList(RAW_SUPPLIER_LIST);
const supplierById = new Map(supplierEntries.map(item => [item.supplierId, item]));

function findSupplierEntryById(id) {
    const key = String(id || '').trim().toUpperCase();
    return supplierById.get(key) || null;
}

function findBestSupplierMatchByInspiredBy(inspiredBy, expectedPrefix) {
    const normalizedQuery = normalizeComparableText(inspiredBy);
    if (!normalizedQuery) return null;

    const candidates = supplierEntries.filter((entry) => {
        if (!entry.inspiredBy) return false;
        if (!expectedPrefix) return true;
        return entry.prefix === expectedPrefix;
    });

    if (!candidates.length) return null;

    const exact = candidates.find(entry => entry.normalizedInspiredBy === normalizedQuery);
    if (exact) {
        return {
            supplierId: exact.supplierId,
            inspiredBy: exact.inspiredBy,
            confidence: 1,
            matchedBy: 'exact'
        };
    }

    const ranked = candidates
        .map(entry => ({
            entry,
            score: similarityScore(normalizedQuery, entry.normalizedInspiredBy)
        }))
        .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.74) {
        return null;
    }

    const alternatives = ranked
        .slice(1, 4)
        .filter(item => item.score >= 0.64)
        .map(item => ({
            supplierId: item.entry.supplierId,
            inspiredBy: item.entry.inspiredBy,
            confidence: Number(item.score.toFixed(3))
        }));

    return {
        supplierId: best.entry.supplierId,
        inspiredBy: best.entry.inspiredBy,
        confidence: Number(best.score.toFixed(3)),
        matchedBy: 'fuzzy',
        alternatives
    };
}

module.exports = {
    supplierEntries,
    findSupplierEntryById,
    findBestSupplierMatchByInspiredBy,
    normalizeComparableText
};

