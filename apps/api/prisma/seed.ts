/**
 * Seeds a realistic, demo-ready club.
 *
 * Idempotent: safe to run repeatedly. Passwords come from the environment where
 * set, and fall back to documented development defaults that the script refuses
 * to use when NODE_ENV is production.
 */
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed');

const prisma = new PrismaClient();

const isProduction = process.env.NODE_ENV === 'production';
const DEV_PASSWORD = 'KodeClub!2026demo';

function passwordFor(key: string): string {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  if (isProduction) {
    throw new Error(
      `${key} must be set when seeding in production. Refusing to create an account with a known password.`,
    );
  }
  return DEV_PASSWORD;
}

const hash = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

const DEPARTMENTS = [
  {
    name: 'Marketing',
    colour: '#F26522',
    description: 'Brand, communications and member storytelling.',
  },
  {
    name: 'Operations',
    colour: '#244EA2',
    description: 'Front office, facilities and the daily run of the club.',
  },
  {
    name: 'Sports and Recreation',
    colour: '#BFD730',
    description: 'Coaching, racquets, pool and studio programming.',
  },
  {
    name: 'Finance',
    colour: '#7F3F98',
    description: 'Membership billing, payroll liaison and procurement.',
  },
  { name: 'IT', colour: '#ED0C6E', description: 'Systems, access and the Odoo helpdesk.' },
];

async function main(): Promise<void> {
  console.log('Seeding KODE Sports Club portal...');

  /* ---------------------------------------------------------- departments */
  const departments = new Map<string, string>();
  for (const department of DEPARTMENTS) {
    const slug = department.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const row = await prisma.department.upsert({
      where: { name: department.name },
      update: { colour: department.colour, description: department.description },
      create: { ...department, slug },
    });
    departments.set(department.name, row.id);
  }

  /* --------------------------------------------------------------- people */
  const people: {
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    department: string | null;
    jobTitle: string;
    passwordEnv: string;
  }[] = [
    {
      email: 'admin@kodesportsclub.com',
      firstName: 'Ziad',
      lastName: 'Ahmed',
      role: 'SUPER_ADMIN',
      department: 'IT',
      jobTitle: 'Head of Technology',
      passwordEnv: 'SEED_SUPER_ADMIN_PASSWORD',
    },
    {
      email: 'marketing@kodesportsclub.com',
      firstName: 'Mariam',
      lastName: 'Adel',
      role: 'CONTENT_MANAGER',
      department: 'Marketing',
      jobTitle: 'Content Manager',
      passwordEnv: 'SEED_CONTENT_MANAGER_PASSWORD',
    },
    {
      email: 'editor@kodesportsclub.com',
      firstName: 'Youssef',
      lastName: 'Kamal',
      role: 'CONTENT_EDITOR',
      department: 'Marketing',
      jobTitle: 'Communications Executive',
      passwordEnv: 'SEED_CONTENT_EDITOR_PASSWORD',
    },
    {
      email: 'operations@kodesportsclub.com',
      firstName: 'Alaa',
      lastName: 'Hassan',
      role: 'DEPARTMENT_EDITOR',
      department: 'Operations',
      jobTitle: 'Front Office Lead',
      passwordEnv: 'SEED_DEPARTMENT_EDITOR_PASSWORD',
    },
    {
      email: 'employee@kodesportsclub.com',
      firstName: 'Nour',
      lastName: 'Fahmy',
      role: 'EMPLOYEE',
      department: 'Sports and Recreation',
      jobTitle: 'Racquet Sports Coach',
      passwordEnv: 'SEED_EMPLOYEE_PASSWORD',
    },
  ];

  const users = new Map<string, string>();
  for (const person of people) {
    const passwordHash = await hash(passwordFor(person.passwordEnv));
    const row = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        firstName: person.firstName,
        lastName: person.lastName,
        role: person.role,
        jobTitle: person.jobTitle,
        departmentId: person.department ? departments.get(person.department)! : null,
        status: 'ACTIVE',
      },
      create: {
        email: person.email,
        firstName: person.firstName,
        lastName: person.lastName,
        jobTitle: person.jobTitle,
        role: person.role,
        status: 'ACTIVE',
        provider: 'LOCAL',
        passwordHash,
        departmentId: person.department ? departments.get(person.department)! : null,
      },
    });
    users.set(person.email, row.id);
  }

  // A few extra directory entries so the People page is not three rows.
  const extras = [
    ['hana.said@kodesportsclub.com', 'Hana', 'Said', 'Membership Advisor', 'Operations'],
    [
      'omar.tarek@kodesportsclub.com',
      'Omar',
      'Tarek',
      'Aquatics Supervisor',
      'Sports and Recreation',
    ],
    ['salma.reda@kodesportsclub.com', 'Salma', 'Reda', 'Financial Analyst', 'Finance'],
    ['karim.nabil@kodesportsclub.com', 'Karim', 'Nabil', 'Systems Engineer', 'IT'],
    ['dina.magdy@kodesportsclub.com', 'Dina', 'Magdy', 'Social Media Lead', 'Marketing'],
  ] as const;

  for (const [email, firstName, lastName, jobTitle, department] of extras) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        firstName,
        lastName,
        jobTitle,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        provider: 'LOCAL',
        passwordHash: await hash(passwordFor('SEED_EMPLOYEE_PASSWORD')),
        departmentId: departments.get(department)!,
      },
    });
  }

  const authorId = users.get('marketing@kodesportsclub.com')!;

  /* ----------------------------------------------------------------- news */
  const articles = [
    {
      slug: 'the-summer-rhythm-inside-kodes-busiest-month',
      title: "The summer rhythm: inside KODE's busiest month",
      excerpt: 'Three thousand check-ins, two new programmes and one very tired coffee machine.',
      category: 'Club life',
      pinned: true,
      status: 'PUBLISHED' as const,
      body: 'August is the month the club stops being a building and becomes a rhythm.\n\nFront office handled just over three thousand check-ins, the pool ran at capacity for eleven consecutive mornings, and the racquet team quietly launched two new junior sessions without a single scheduling clash.\n\nWhat made it work was not heroics. It was the handover notes, the shared calendar discipline, and people covering for each other without being asked.',
    },
    {
      slug: 'how-the-racquet-team-turns-member-feedback-into-action',
      title: 'How the Racquet team turns member feedback into action',
      excerpt: 'A short loop between a comment card and a changed court schedule.',
      category: 'People',
      status: 'PUBLISHED' as const,
      body: 'Every Monday the racquet coaches read the previous week of member comments together. Anything that appears three times becomes an action.\n\nThat is how the 06:30 slot appeared, how the ball machine moved to court four, and why the beginner ladder now runs fortnightly instead of monthly.',
    },
    {
      slug: 'a-quieter-arrival-our-new-member-welcome-flow',
      title: 'A quieter arrival: our new member welcome flow',
      excerpt: 'Fewer forms, one named contact and a tour that actually ends at the locker.',
      category: 'Operations',
      status: 'IN_REVIEW' as const,
      body: 'The old welcome took nineteen minutes and three members of staff. The new one takes seven and one.\n\nThe change was mostly subtraction: we removed two forms that duplicated the membership system, and we stopped explaining the app before people had their locker key.',
    },
    {
      slug: 'studio-two-reopens-with-a-new-floor',
      title: 'Studio 02 reopens with a new floor',
      excerpt: 'Sprung timber, better acoustics, and the mirror wall finally straight.',
      category: 'Facilities',
      status: 'DRAFT' as const,
      body: 'Studio 02 closed for eleven days and reopens on Monday with a sprung timber floor, replacement acoustic panels along the north wall, and a mirror line that is, at last, level.',
    },
  ];

  for (const article of articles) {
    await prisma.article.upsert({
      where: { slug: article.slug },
      update: {},
      create: {
        ...article,
        authorId,
        publishedAt:
          article.status === 'PUBLISHED'
            ? new Date(Date.now() - Math.random() * 12 * 86_400_000)
            : null,
      },
    });
  }

  /* --------------------------------------------------------------- events */
  const day = 86_400_000;
  /*
   * Event kinds are rows now, not enum members, so the seed installs them the
   * same way it installs departments. `isSystem` marks them as built in: the
   * CMS will let an admin rename, recolour, reorder or archive them, but never
   * delete them, so the create form's required select cannot be emptied.
   */
  const eventKinds = [
    { key: 'CLUB_MOMENT', label: 'Club moment', colour: '#244EA2', sortOrder: 10 },
    { key: 'LEARNING', label: 'Learning', colour: '#BFD730', sortOrder: 20 },
    { key: 'WELLBEING', label: 'Wellbeing', colour: '#7F3F98', sortOrder: 30 },
    { key: 'ANNOUNCEMENT', label: 'Announcement', colour: '#F26522', sortOrder: 40 },
  ];

  const kindByKey = new Map<string, string>();
  for (const term of eventKinds) {
    const row = await prisma.taxonomy.upsert({
      where: { kind_key: { kind: 'EVENT_KIND', key: term.key } },
      update: { label: term.label, colour: term.colour, sortOrder: term.sortOrder },
      create: { kind: 'EVENT_KIND', isSystem: true, ...term },
    });
    kindByKey.set(term.key, row.id);
  }

  const events = [
    {
      slug: 'staff-padel-evening',
      title: 'Staff padel evening',
      kind: 'CLUB_MOMENT' as const,
      location: 'Padel courts',
      description:
        'Doubles, no scoring pressure, and food afterwards. All levels, racquets provided.',
      startsAt: new Date(Date.now() + 3 * day),
      status: 'PUBLISHED' as const,
    },
    {
      slug: 'first-aid-refresher',
      title: 'First aid refresher',
      kind: 'LEARNING' as const,
      location: 'Studio 02',
      description:
        'Annual refresher covering CPR, AED use and the club incident procedure. Required for poolside staff.',
      startsAt: new Date(Date.now() + 9 * day),
      capacity: 24,
      status: 'PUBLISHED' as const,
    },
    {
      slug: 'kode-open-house',
      title: 'KODE open house',
      kind: 'CLUB_MOMENT' as const,
      location: 'Main clubhouse',
      description:
        'Members bring a guest, the club shows its best face. All departments on the floor.',
      startsAt: new Date(Date.now() + 18 * day),
      status: 'PUBLISHED' as const,
    },
    {
      slug: 'wellbeing-hour-sleep-and-shift-work',
      title: 'Wellbeing hour: sleep and shift work',
      kind: 'WELLBEING' as const,
      location: 'Meeting room 1',
      description:
        'Practical session for staff on rotating shifts. Run by an external occupational health advisor.',
      startsAt: new Date(Date.now() + 25 * day),
      status: 'DRAFT' as const,
    },
  ];

  for (const { kind, ...event } of events) {
    const kindId = kindByKey.get(kind);
    if (!kindId) throw new Error(`Seed refers to an event kind that was not created: ${kind}`);
    await prisma.event.upsert({
      where: { slug: event.slug },
      update: {},
      create: { ...event, kindId },
    });
  }

  /* ------------------------------------------------------------- policies */
  const policies = [
    {
      slug: 'general-health-and-safety-policy',
      title: 'General health & safety policy',
      summary: 'What every employee must know about incidents, hazards and reporting.',
      version: '3.2',
      departmentId: null,
      reviewDueAt: new Date(Date.now() + 5 * day),
      status: 'PUBLISHED' as const,
      body: 'Every employee is responsible for the safety of members, guests and colleagues.\n\nReport hazards the moment you see them. Report incidents within the same shift, even where nobody was hurt. Never move equipment you are not trained to move.',
    },
    {
      slug: 'front-office-standards',
      title: 'Front Office standards',
      summary: 'Greeting, check-in, escalation and the handover note.',
      version: '2.0',
      departmentName: 'Operations',
      reviewDueAt: new Date(Date.now() - 2 * day),
      status: 'PUBLISHED' as const,
      body: 'Acknowledge every member within ten seconds of arrival, by name where you know it.\n\nEscalate anything involving money, medical matters or a complaint to the duty manager rather than resolving it yourself.',
    },
    {
      slug: 'brand-and-communications-guidelines',
      title: 'Brand and communications guidelines',
      summary: 'Voice, logo use and who may speak for the club.',
      version: '1.4',
      departmentName: 'Marketing',
      status: 'PUBLISHED' as const,
      body: 'The KODE voice is direct, warm and specific. Avoid superlatives we cannot evidence.\n\nOnly the Marketing lead and the General Manager speak to press.',
    },
    {
      slug: 'it-acceptable-use',
      title: 'IT acceptable use',
      summary: 'Accounts, devices, passwords and what to do when something looks wrong.',
      version: '2.1',
      departmentName: 'IT',
      status: 'IN_REVIEW' as const,
      body: 'Club accounts are for club work. Never share a password, including with IT.\n\nIf a message asks you to sign in unexpectedly, stop and raise a support request instead.',
    },
  ];

  for (const { departmentName, ...policy } of policies as ((typeof policies)[number] & {
    departmentName?: string;
  })[]) {
    await prisma.policy.upsert({
      where: { slug: policy.slug },
      update: {},
      create: {
        ...policy,
        departmentId: departmentName
          ? departments.get(departmentName)!
          : (policy.departmentId ?? null),
      },
    });
  }

  /* ----------------------------------------------------------------- faqs */
  const faqs = [
    [
      'How do I book a training room?',
      'Rooms are booked through Outlook calendar resources. Search for "KODE Room" when adding a location. Anything over two hours needs duty manager approval.',
      'Workplace',
      0,
    ],
    [
      'How do I raise an IT request?',
      'Use the IT support page in this portal. Your request reaches the KODE IT inbox and opens an Odoo ticket automatically. You will get the reference immediately.',
      'IT support',
      1,
    ],
    [
      'Where can I find my department policy?',
      'The Policies page shows general policies plus anything specific to your department. If something is missing, ask your department lead.',
      'Workplace',
      2,
    ],
    [
      'How do I update my staff profile?',
      'Open your profile from the header menu. Name, job title, phone and photo are yours to change; department and role are set by a Super Admin.',
      'Workplace',
      3,
    ],
    [
      'What do I do if I find a hazard?',
      'Make the area safe if you can do so without risk, then report it to the duty manager the same shift. Do not wait for the end of the day.',
      'Health and safety',
      4,
    ],
  ] as const;

  for (const [question, answer, category, position] of faqs) {
    const existing = await prisma.faq.findFirst({ where: { question } });
    if (!existing) {
      await prisma.faq.create({
        data: { question, answer, category, position, status: 'PUBLISHED' },
      });
    }
  }

  /* ----------------------------------------------------------- quicklinks */
  const links = [
    ['Outlook', 'https://outlook.office.com', 'Club email and calendar', 'external', 0],
    ['Odoo', 'https://odoo.kodesportsclub.com', 'HR, payroll and the IT helpdesk', 'external', 1],
    [
      'Payslips',
      'https://odoo.kodesportsclub.com/my/payslips',
      'Your monthly payslips in Odoo',
      'external',
      2,
    ],
    [
      'Booking system',
      'https://booking.kodesportsclub.com',
      'Courts, studios and lanes',
      'external',
      3,
    ],
  ] as const;

  for (const [title, url, description, icon, position] of links) {
    const existing = await prisma.quickLink.findFirst({ where: { title } });
    if (!existing) {
      await prisma.quickLink.create({
        data: { title, url, description, icon, position, status: 'PUBLISHED' },
      });
    }
  }

  /* ------------------------------------------------------------- tickets */
  const requesterId = users.get('employee@kodesportsclub.com')!;
  if ((await prisma.supportTicket.count()) === 0) {
    await prisma.supportTicket.create({
      data: {
        reference: 'KODE-IT-000001',
        subject: 'Court booking screen frozen at reception',
        body: 'The booking terminal at the racquet desk freezes when I open the weekly view. Restarting works for about an hour.',
        category: 'HARDWARE',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        location: 'Racquet reception',
        requesterId,
        assigneeId: users.get('admin@kodesportsclub.com')!,
      },
    });
  }

  console.log('Seed complete.');
  if (!isProduction) {
    console.log('\nDevelopment sign-in accounts (password: %s):', DEV_PASSWORD);
    for (const person of people) {
      console.log(`  ${person.role.padEnd(18)} ${person.email}`);
    }
    console.log('');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
