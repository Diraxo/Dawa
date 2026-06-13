import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import HowItWorks from '@/components/landing/HowItWorks'
import Specialties from '@/components/landing/Specialties'
import Stats from '@/components/landing/Stats'
import ForDoctors from '@/components/landing/ForDoctors'
import Testimonials from '@/components/landing/Testimonials'
import Footer from '@/components/landing/Footer'

export default function LandingPage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <HowItWorks />
      <Specialties />
      <Stats />
      <ForDoctors />
      <Testimonials />
      <Footer />
    </main>
  )
}
