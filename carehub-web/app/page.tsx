import dynamic from 'next/dynamic'
import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'

const HowItWorks   = dynamic(() => import('@/components/landing/HowItWorks'))
const Specialties  = dynamic(() => import('@/components/landing/Specialties'))
const Stats        = dynamic(() => import('@/components/landing/Stats'))
const ForDoctors   = dynamic(() => import('@/components/landing/ForDoctors'))
const Testimonials = dynamic(() => import('@/components/landing/Testimonials'))
const Footer       = dynamic(() => import('@/components/landing/Footer'))

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
