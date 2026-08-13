import dotenv from 'dotenv';
import { connectDB } from '../config/db';
import ServiceItem from '../models/ServiceItem';
import FaqItem from '../models/FaqItem';
import ContactDetail from '../models/ContactDetail';

dotenv.config();

const services = [
  { title: 'Private Dining', description: 'An intimate, multi-course experience in your own home.', order: 0 },
  { title: 'Corporate Events', description: 'Catering shaped around your schedule and the impression you want to leave.', order: 1 },
  { title: 'Weddings & Celebrations', description: 'Full-service catering for moments that deserve more than a standard buffet.', order: 2 },
  { title: 'Personal Chef Experience', description: 'Recurring or one-off in-home cooking shaped around your household.', order: 3 },
];

const faqs = [
  { question: 'How far in advance should I book?', answer: 'For private dinners, two to three weeks is comfortable. For weddings or large events, six to eight weeks lets us plan properly, including a tasting.', order: 0 },
  { question: 'Can you accommodate dietary restrictions?', answer: 'Yes — vegetarian, vegan, gluten-free, and allergy-specific menus are all things we plan for from the start, not substitute in at the last minute.', order: 1 },
  { question: 'Do you travel outside Lagos?', answer: 'For larger events, yes. Travel and logistics are quoted separately based on distance and event size.', order: 2 },
  { question: 'What’s included in a private dining booking?', answer: 'The chef, the full menu (tasted and agreed beforehand), service staff for the evening, and cleanup. Tableware and venue are discussed case by case.', order: 3 },
];

const contact = [
  { key: 'address', label: 'Address', value: '14 Ilaro Crescent, Lagos' },
  { key: 'hours', label: 'Opening hours', value: 'Tue – Sun, 7am – 10pm' },
  { key: 'phone', label: 'Phone', value: '+234 908 331 7591' },
  { key: 'email', label: 'Email', value: 'hello@timavellecuisine.com' },
];

async function seed() {
  await connectDB();
  let created = 0;
  for (const service of services) {
    if (!(await ServiceItem.exists({ title: service.title }))) {
      await ServiceItem.create({ ...service, published: { ...service, publishedAt: new Date() } });
      created += 1;
    }
  }
  for (const faq of faqs) {
    if (!(await FaqItem.exists({ question: faq.question }))) {
      await FaqItem.create({ ...faq, published: { ...faq, publishedAt: new Date() } });
      created += 1;
    }
  }
  for (const detail of contact) {
    if (!(await ContactDetail.exists({ key: detail.key }))) {
      await ContactDetail.create({ ...detail, published: { label: detail.label, value: detail.value, publishedAt: new Date() } });
      created += 1;
    }
  }
  console.log(`Content seed complete. Created ${created} records.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
