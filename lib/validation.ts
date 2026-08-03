import { z } from 'zod'

export const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
})

export const doctorRegistrationSchema = z.object({
  licenseNumber: z
    .string()
    .min(5, 'License number must be at least 5 characters')
    .max(50, 'License number too long'),
  specialty: z.string().min(1, 'Please select a specialty'),
  yearsExperience: z.number().min(0, 'Invalid experience').max(50, 'Invalid experience'),
  hospitalName: z
    .string()
    .min(2, 'Hospital name too short')
    .max(200, 'Hospital name too long'),
  bio: z.string().max(300, 'Bio cannot exceed 300 characters'),
  chatPrice: z.number().min(1, 'Chat price must be greater than 0'),
  phonePrice: z.number().min(1, 'Phone price must be greater than 0'),
  videoPrice: z.number().min(1, 'Video price must be greater than 0'),
})

export const reviewSchema = z.object({
  rating: z.number().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  comment: z.string().max(500, 'Comment cannot exceed 500 characters').optional(),
})

export const bookingSchema = z.object({
  consultationType: z.enum(['chat', 'phone', 'video']),
  scheduledAt: z.string().datetime({ message: 'Invalid date format' }).optional(),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type DoctorRegistrationInput = z.infer<typeof doctorRegistrationSchema>
export type ReviewInput = z.infer<typeof reviewSchema>
export type BookingInput = z.infer<typeof bookingSchema>
