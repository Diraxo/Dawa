import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

export interface ReportPrescription {
  medicine: string
  dosage: string
  duration: string
  instructions: string
}

export interface ConsultationReportData {
  consultationId: string
  consultationType: string
  visitDate: string
  doctorName: string
  doctorSpecialty: string
  patientName: string
  chiefComplaint: string | null
  diagnosis: string | null
  prescription: ReportPrescription[]
  followupRecommendation: string | null
  referralNeeded: boolean
  referralSpecialty: string | null
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1A1A1A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '2 solid #00BFA5', paddingBottom: 12, marginBottom: 16,
  },
  logo: { width: 28, height: 28 },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  brandAccent: { color: '#00BFA5' },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 10, color: '#666' },
  metaGrid: {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#F5F6F8',
    borderRadius: 6, padding: 12, marginBottom: 16,
  },
  metaItem: { width: '50%', marginBottom: 8 },
  metaLabel: { fontSize: 8, color: '#888', textTransform: 'uppercase', marginBottom: 2, letterSpacing: 0.5 },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  section: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#00877A',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  sectionValue: { fontSize: 10, lineHeight: 1.5 },
  rxRow: { borderBottom: '1 solid #EEE', paddingVertical: 6 },
  rxMedicine: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  rxDetail: { fontSize: 9, color: '#555', marginTop: 2 },
  referralBox: {
    backgroundColor: '#EAF2FF', borderRadius: 6, padding: 10, fontSize: 10, color: '#1A4598',
  },
  footer: {
    position: 'absolute', bottom: 28, left: 36, right: 36,
    borderTop: '1 solid #EEE', paddingTop: 8, fontSize: 8, color: '#999',
    flexDirection: 'row', justifyContent: 'space-between',
  },
})

export function ConsultationReportDocument({ data, logoUrl }: { data: ConsultationReportData; logoUrl?: string }) {
  return (
    <Document title={`Dawa Consultation Report — ${data.consultationId}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
            <Text style={styles.brand}>DA<Text style={styles.brandAccent}>WA</Text></Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>Official Consultation Report</Text>
            <Text style={styles.title}>ID: {data.consultationId}</Text>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Doctor</Text>
            <Text style={styles.metaValue}>Dr. {data.doctorName}</Text>
            <Text style={{ fontSize: 9, color: '#666' }}>{data.doctorSpecialty}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Patient</Text>
            <Text style={styles.metaValue}>{data.patientName}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Visit Date</Text>
            <Text style={styles.metaValue}>{data.visitDate}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Consultation Type</Text>
            <Text style={styles.metaValue}>{data.consultationType}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Chief Complaint</Text>
          <Text style={styles.sectionValue}>{data.chiefComplaint || 'Not recorded'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Diagnosis</Text>
          <Text style={styles.sectionValue}>{data.diagnosis || 'Not recorded'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Prescription</Text>
          {data.prescription.length > 0 ? (
            data.prescription.map((rx, i) => (
              <View key={i} style={styles.rxRow}>
                <Text style={styles.rxMedicine}>{rx.medicine}</Text>
                {(rx.dosage || rx.duration) && (
                  <Text style={styles.rxDetail}>{[rx.dosage, rx.duration].filter(Boolean).join(' · ')}</Text>
                )}
                {rx.instructions ? <Text style={styles.rxDetail}>{rx.instructions}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.sectionValue}>No prescription issued</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Follow-up Recommendation</Text>
          <Text style={styles.sectionValue}>{data.followupRecommendation || 'None'}</Text>
        </View>

        {data.referralNeeded && (
          <View style={styles.section}>
            <Text style={styles.referralBox}>
              Specialist referral recommended{data.referralSpecialty ? ` — ${data.referralSpecialty}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Generated by Dawa Telemedicine — for patient records</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
