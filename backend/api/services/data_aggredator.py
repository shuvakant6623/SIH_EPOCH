from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import asyncio
import logging
from collections import Counter, defaultdict
import json
import uuid
from dataclasses import dataclass, asdict
from geopy.distance import geodesic
import numpy as np

# Import your existing components
from backend.api.models.database import (
    HazardReport, AuthorityAlerts, IST, Hazard_SessionLocal
)
from backend.api.models.schemas import AuthorityAlertCreate
from nlp_analyzer import AdvancedHazardNLP, SocialMediaStreamAnalyzer
from notification import AuthorityNotificationService

router = APIRouter()
logger = logging.getLogger(__name__)

@dataclass
class AggregatedThreat:
    threat_id: str
    threat_type: str
    severity_level: str  # low, medium, high, critical
    confidence_score: float
    geographical_center: Tuple[float, float]
    affected_radius_km: float
    report_count: int
    social_media_mentions: int
    first_detected: datetime
    last_updated: datetime
    affected_locations: List[str]
    trend_direction: str  # increasing, stable, decreasing
    authority_notified: bool
    verification_status: str  # unverified, partially_verified, verified, false_alarm


class DataAggregator:
    def __init__(self):
        self.nlp_analyzer = AdvancedHazardNLP()
        self.social_analyzer = SocialMediaStreamAnalyzer(self.nlp_analyzer)
        self.notification_service = AuthorityNotificationService()
        
        # Configuration
        self.clustering_radius = 10.0  # km
        self.threat_expiry_hours = 48
        self.min_reports_for_cluster = 2
        self.social_media_weight = 0.3
        self.citizen_report_weight = 0.7
        
        # Threat level thresholds
        self.severity_thresholds = {
            'critical': 4.0,
            'high': 3.0,
            'medium': 2.0,
            'low': 1.0
        }
        
        # Cache for active threats
        self.active_threats = {}
        self.last_aggregation = None

    def get_db(self):
        """Get database session"""
        db = Hazard_SessionLocal()
        try:
            return db
        finally:
            db.close()

    async def aggregate_all_data(self) -> Dict:
        """Main aggregation function that combines all data sources"""
        try:
            db = self.get_db()
            
            # Get recent citizen reports
            citizen_data = await self._aggregate_citizen_reports(db)
            
            # Get social media analysis
            social_data = await self._aggregate_social_media_data()
            
            # Combine and analyze threats
            combined_threats = await self._combine_threat_sources(citizen_data, social_data)
            
            # Generate spatial clusters
            spatial_clusters = await self._generate_spatial_clusters(combined_threats)
            
            # Calculate risk assessment
            risk_assessment = await self._calculate_regional_risk(spatial_clusters)
            
            # Generate authority recommendations
            recommendations = await self._generate_authority_recommendations(spatial_clusters)
            
            # Update active threats cache
            self.active_threats = {threat.threat_id: threat for threat in spatial_clusters}
            self.last_aggregation = datetime.now(IST)
            
            db.close()
            
            return {
                'aggregation_timestamp': self.last_aggregation.isoformat(),
                'total_active_threats': len(spatial_clusters),
                'citizen_reports_analyzed': len(citizen_data),
                'social_media_analyzed': social_data.get('total_posts_analyzed', 0),
                'active_threats': [asdict(threat) for threat in spatial_clusters],
                'risk_assessment': risk_assessment,
                'authority_recommendations': recommendations,
                'data_freshness': {
                    'citizen_reports': 'last_24h',
                    'social_media': 'last_6h',
                    'weather_data': 'current'
                }
            }
            
        except Exception as e:
            logger.error(f"Error in data aggregation: {e}")
            raise HTTPException(status_code=500, detail=f"Aggregation failed: {str(e)}")

    async def _aggregate_citizen_reports(self, db: Session) -> List[HazardReport]:
        """Aggregate recent citizen reports"""
        cutoff_time = datetime.now(IST) - timedelta(hours=self.threat_expiry_hours)
        
        reports = db.query(HazardReport).filter(
            HazardReport.timestamp >= cutoff_time
        ).order_by(HazardReport.timestamp.desc()).all()
        
        logger.info(f"Retrieved {len(reports)} citizen reports from last {self.threat_expiry_hours}h")
        return reports

    async def _aggregate_social_media_data(self) -> Dict:
        """Get recent social media analysis results"""
        try:
            # Get trending hazards from social media analyzer
            trends = await self._get_social_media_trends()
            return trends
        except Exception as e:
            logger.warning(f"Social media data unavailable: {e}")
            return {'total_posts_analyzed': 0, 'trending': []}

    async def _get_social_media_trends(self) -> Dict:
        """Mock social media trends - replace with actual implementation"""
        return {
            'total_posts_analyzed': 342,
            'trending': [
                {
                    'hazard_type': 'cyclone',
                    'mention_count': 89,
                    'confidence_avg': 0.76,
                    'top_affected_areas': ['Chennai', 'Puducherry', 'Cuddalore'],
                    'sentiment_score': -0.65,
                    'urgency_indicators': 15
                },
                {
                    'hazard_type': 'coastal_flooding',
                    'mention_count': 127,
                    'confidence_avg': 0.82,
                    'top_affected_areas': ['Mumbai', 'Thane', 'Navi Mumbai'],
                    'sentiment_score': -0.72,
                    'urgency_indicators': 23
                }
            ]
        }

    async def _combine_threat_sources(self, citizen_reports: List, social_data: Dict) -> List[Dict]:
        """Combine citizen reports and social media data into unified threat objects"""
        combined_threats = []
        
        # Process citizen reports
        for report in citizen_reports:
            threat = {
                'source': 'citizen_report',
                'id': report.id,
                'hazard_type': report.hazard_type,
                'latitude': report.latitude,
                'longitude': report.longitude,
                'severity': report.severity,
                'confidence': min(report.priority_score / 5.0, 1.0),
                'timestamp': report.timestamp,
                'location_name': report.location_name,
                'description': report.description,
                'verification_status': report.verification_status or 'unverified'
            }
            combined_threats.append(threat)
        
        # Process social media trends
        for trend in social_data.get('trending', []):
            for area in trend.get('top_affected_areas', []):
                # Estimate coordinates for major areas (you'd want a proper geocoding service)
                coords = self._estimate_coordinates(area)
                if coords:
                    threat = {
                        'source': 'social_media',
                        'id': f"social_{trend['hazard_type']}_{area}",
                        'hazard_type': trend['hazard_type'],
                        'latitude': coords[0],
                        'longitude': coords[1],
                        'severity': self._estimate_severity_from_social(trend),
                        'confidence': trend.get('confidence_avg', 0.5),
                        'timestamp': datetime.now(IST),
                        'location_name': area,
                        'description': f"Social media trend: {trend['mention_count']} mentions",
                        'verification_status': 'social_media'
                    }
                    combined_threats.append(threat)
        
        return combined_threats

    def _estimate_coordinates(self, location_name: str) -> Optional[Tuple[float, float]]:
        """Estimate coordinates for major Indian coastal cities"""
        city_coords = {
            'mumbai': (19.0760, 72.8777),
            'chennai': (13.0827, 80.2707),
            'kolkata': (22.5726, 88.3639),
            'kochi': (9.9312, 76.2673),
            'visakhapatnam': (17.6868, 83.2185),
            'thiruvananthapuram': (8.5241, 76.9366),
            'mangalore': (12.9141, 74.8560),
            'puri': (19.8135, 85.8312),
            'goa': (15.2993, 74.1240),
            'surat': (21.1702, 72.8311),
            'puducherry': (11.9416, 79.8083),
            'bhubaneswar': (20.2961, 85.8245),
            'paradip': (20.3086, 86.6236),
            'kandla': (23.0225, 70.2167),
            'tuticorin': (8.7642, 78.1348),
            'calicut': (11.2588, 75.7804),
            'thane': (19.2183, 72.9781),
            'navi mumbai': (19.0330, 73.0297),
            'cuddalore': (11.7480, 79.7714)
        }
        
        return city_coords.get(location_name.lower())

    def _estimate_severity_from_social(self, trend: Dict) -> int:
        """Estimate severity from social media indicators"""
        mention_count = trend.get('mention_count', 0)
        sentiment = abs(trend.get('sentiment_score', 0))
        urgency = trend.get('urgency_indicators', 0)
        
        # Simple scoring algorithm
        score = (mention_count / 50.0) + (sentiment * 2) + (urgency / 10.0)
        return min(int(score) + 1, 5)

    async def _generate_spatial_clusters(self, threats: List[Dict]) -> List[AggregatedThreat]:
        """Generate spatial clusters of threats"""
        clusters = []
        processed_threats = set()
        
        for i, threat in enumerate(threats):
            if i in processed_threats:
                continue
                
            # Find nearby threats
            cluster_threats = [threat]
            threat_location = (threat['latitude'], threat['longitude'])
            
            for j, other_threat in enumerate(threats[i+1:], i+1):
                if j in processed_threats:
                    continue
                    
                other_location = (other_threat['latitude'], other_threat['longitude'])
                distance = geodesic(threat_location, other_location).kilometers
                
                if distance <= self.clustering_radius:
                    cluster_threats.append(other_threat)
                    processed_threats.add(j)
            
            processed_threats.add(i)
            
            # Create aggregated threat
            if len(cluster_threats) >= self.min_reports_for_cluster or any(
                t['source'] == 'citizen_report' for t in cluster_threats
            ):
                aggregated = await self._create_aggregated_threat(cluster_threats)
                clusters.append(aggregated)
        
        # Sort by severity and confidence
        clusters.sort(key=lambda x: (x.confidence_score * 
                                   self._severity_to_numeric(x.severity_level)), reverse=True)
        
        return clusters

    async def _create_aggregated_threat(self, cluster_threats: List[Dict]) -> AggregatedThreat:
        """Create an aggregated threat from a cluster of individual threats"""
        # Calculate center coordinates
        lats = [t['latitude'] for t in cluster_threats]
        lons = [t['longitude'] for t in cluster_threats]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)
        
        # Calculate radius
        center = (center_lat, center_lon)
        max_distance = max([
            geodesic(center, (t['latitude'], t['longitude'])).kilometers 
            for t in cluster_threats
        ])
        
        # Determine primary threat type
        threat_types = [t['hazard_type'] for t in cluster_threats]
        primary_type = Counter(threat_types).most_common(1)[0][0]
        
        # Calculate weighted confidence
        citizen_reports = [t for t in cluster_threats if t['source'] == 'citizen_report']
        social_reports = [t for t in cluster_threats if t['source'] == 'social_media']
        
        citizen_confidence = np.mean([t['confidence'] for t in citizen_reports]) if citizen_reports else 0
        social_confidence = np.mean([t['confidence'] for t in social_reports]) if social_reports else 0
        
        combined_confidence = (
            citizen_confidence * self.citizen_report_weight +
            social_confidence * self.social_media_weight
        )
        
        # Calculate severity
        severities = [t['severity'] for t in cluster_threats if t.get('severity')]
        avg_severity = np.mean(severities) if severities else 2.0
        severity_level = self._numeric_to_severity(avg_severity)
        
        # Get affected locations
        locations = list(set([t['location_name'] for t in cluster_threats if t.get('location_name')]))
        
        # Determine verification status
        verification_statuses = [t.get('verification_status', 'unverified') for t in cluster_threats]
        if 'verified' in verification_statuses:
            verification = 'verified'
        elif 'partially_verified' in verification_statuses:
            verification = 'partially_verified'
        else:
            verification = 'unverified'
        
        return AggregatedThreat(
            threat_id=str(uuid.uuid4()),
            threat_type=primary_type,
            severity_level=severity_level,
            confidence_score=combined_confidence,
            geographical_center=(center_lat, center_lon),
            affected_radius_km=max(max_distance, 1.0),
            report_count=len(citizen_reports),
            social_media_mentions=len(social_reports),
            first_detected=min([t['timestamp'] for t in cluster_threats]),
            last_updated=max([t['timestamp'] for t in cluster_threats]),
            affected_locations=locations,
            trend_direction='increasing',  # Would calculate based on temporal analysis
            authority_notified=False,
            verification_status=verification
        )

    def _severity_to_numeric(self, severity: str) -> float:
        """Convert severity level to numeric value"""
        return self.severity_thresholds.get(severity, 1.0)

    def _numeric_to_severity(self, numeric: float) -> str:
        """Convert numeric severity to level"""
        if numeric >= 4.0:
            return 'critical'
        elif numeric >= 3.0:
            return 'high'
        elif numeric >= 2.0:
            return 'medium'
        else:
            return 'low'

    async def _calculate_regional_risk(self, threats: List[AggregatedThreat]) -> Dict:
        """Calculate regional risk assessment"""
        regional_risks = defaultdict(lambda: {'threat_count': 0, 'max_severity': 0, 'hazard_types': set()})
        
        for threat in threats:
            for location in threat.affected_locations:
                regional_risks[location]['threat_count'] += 1
                regional_risks[location]['hazard_types'].add(threat.threat_type)
                
                severity_numeric = self._severity_to_numeric(threat.severity_level)
                if severity_numeric > regional_risks[location]['max_severity']:
                    regional_risks[location]['max_severity'] = severity_numeric
        
        # Convert to final format
        risk_assessment = {}
        for region, data in regional_risks.items():
            risk_assessment[region] = {
                'threat_count': data['threat_count'],
                'risk_level': self._numeric_to_severity(data['max_severity']),
                'hazard_types': list(data['hazard_types']),
                'recommendation': self._get_region_recommendation(data)
            }
        
        return risk_assessment

    def _get_region_recommendation(self, data: Dict) -> str:
        """Generate recommendation for a region based on threat data"""
        if data['max_severity'] >= 4.0:
            return "Immediate evacuation and emergency response required"
        elif data['max_severity'] >= 3.0:
            return "Enhanced monitoring and preparation for potential evacuation"
        elif data['max_severity'] >= 2.0:
            return "Increased vigilance and public awareness campaigns"
        else:
            return "Continue routine monitoring"

    async def _generate_authority_recommendations(self, threats: List[AggregatedThreat]) -> List[Dict]:
        """Generate recommendations for authority notification"""
        recommendations = []
        
        for threat in threats:
            if threat.confidence_score >= 0.7 or threat.severity_level in ['high', 'critical']:
                # Determine appropriate authorities
                authorities = self._determine_authorities(threat)
                
                for authority in authorities:
                    recommendations.append({
                        'threat_id': threat.threat_id,
                        'authority_type': authority,
                        'urgency': threat.severity_level,
                        'message': self._generate_alert_message(threat),
                        'recommended_actions': self._get_recommended_actions(threat, authority)
                    })
        
        return recommendations

    def _determine_authorities(self, threat: AggregatedThreat) -> List[str]:
        """Determine which authorities should be notified for a threat"""
        authorities = []
        
        if threat.threat_type in ['tsunami', 'storm_surge']:
            authorities.extend(['coast_guard', 'disaster_management', 'navy'])
        elif threat.threat_type in ['cyclone', 'high_waves']:
            authorities.extend(['coast_guard', 'disaster_management'])
        elif threat.threat_type in ['coastal_flooding']:
            authorities.extend(['disaster_management', 'fire_dept'])
        
        if threat.severity_level in ['high', 'critical']:
            authorities.extend(['police', 'medical_emergency'])
        
        return list(set(authorities))

    def _generate_alert_message(self, threat: AggregatedThreat) -> str:
        """Generate alert message for authorities"""
        locations = ', '.join(threat.affected_locations[:3])
        if len(threat.affected_locations) > 3:
            locations += f" and {len(threat.affected_locations) - 3} other areas"
        
        return (
            f"{threat.severity_level.upper()} {threat.threat_type.replace('_', ' ').title()} alert for {locations}. "
            f"Confidence: {threat.confidence_score:.2f}. "
            f"Based on {threat.report_count} citizen reports and {threat.social_media_mentions} social media mentions. "
            f"Affected radius: {threat.affected_radius_km:.1f}km."
        )

    def _get_recommended_actions(self, threat: AggregatedThreat, authority: str) -> List[str]:
        """Get recommended actions for specific authority"""
        actions = {
            'coast_guard': [
                "Deploy patrol vessels to affected areas",
                "Issue marine weather warnings",
                "Coordinate with fishing vessels for safe harbor"
            ],
            'disaster_management': [
                "Activate emergency response protocols",
                "Prepare evacuation plans",
                "Coordinate with local authorities"
            ],
            'police': [
                "Secure affected areas",
                "Assist with evacuations",
                "Manage traffic and crowd control"
            ],
            'fire_dept': [
                "Pre-position rescue teams",
                "Prepare flood rescue equipment",
                "Coordinate with emergency medical services"
            ]
        }
        
        return actions.get(authority, ["Monitor situation and provide assistance as needed"])

    async def process_automated_alerts(self, background_tasks: BackgroundTasks):
        """Process automated alerts based on aggregated data"""
        try:
            aggregated_data = await self.aggregate_all_data()
            
            # Create authority alerts for high-priority threats
            db = self.get_db()
            
            for threat in aggregated_data['active_threats']:
                threat_obj = AggregatedThreat(**threat)
                
                if (threat_obj.confidence_score >= 0.7 or 
                    threat_obj.severity_level in ['high', 'critical']):
                    
                    # Create alert in database
                    alert_data = AuthorityAlertCreate(
                        report_id=f"aggregated_{threat_obj.threat_id}",
                        authority_type='disaster_management',
                        message=self._generate_alert_message(threat_obj),
                        status='high_priority' if threat_obj.severity_level == 'high' else 'urgent'
                    )
                    
                    # Add to background task for notification
                    background_tasks.add_task(
                        self._send_authority_notification,
                        alert_data,
                        threat_obj
                    )
            
            db.close()
            
            return {
                'status': 'success',
                'alerts_processed': len(aggregated_data['active_threats']),
                'notifications_queued': len([
                    t for t in aggregated_data['active_threats'] 
                    if t['confidence_score'] >= 0.7
                ])
            }
            
        except Exception as e:
            logger.error(f"Error processing automated alerts: {e}")
            return {'status': 'error', 'message': str(e)}

    async def _send_authority_notification(self, alert_data: AuthorityAlertCreate, threat: AggregatedThreat):
        """Send notification to authorities (background task)"""
        try:
            # This would integrate with your notification service
            logger.info(f"Sending notification for threat {threat.threat_id}")
            # await self.notification_service.process_alert(alert_id)
        except Exception as e:
            logger.error(f"Failed to send notification: {e}")


# Initialize global aggregator instance
data_aggregator = DataAggregator()


@router.get("/api/data/aggregate")
async def get_aggregated_data():
    """Get comprehensive aggregated threat data"""
    return await data_aggregator.aggregate_all_data()


@router.get("/api/data/threats")
async def get_active_threats(
    severity_filter: Optional[str] = Query(None),
    region_filter: Optional[str] = Query(None)
):
    """Get active threats with optional filtering"""
    aggregated = await data_aggregator.aggregate_all_data()
    threats = aggregated['active_threats']
    
    if severity_filter:
        threats = [t for t in threats if t['severity_level'] == severity_filter]
    
    if region_filter:
        threats = [t for t in threats if region_filter in t['affected_locations']]
    
    return {
        'threats': threats,
        'total_count': len(threats),
        'filters_applied': {
            'severity': severity_filter,
            'region': region_filter
        }
    }


@router.get("/api/data/risk-assessment")
async def get_risk_assessment():
    """Get regional risk assessment"""
    aggregated = await data_aggregator.aggregate_all_data()
    return aggregated['risk_assessment']


@router.post("/api/data/process-alerts")
async def process_automated_alerts_endpoint(background_tasks: BackgroundTasks):
    """Trigger automated alert processing"""
    return await data_aggregator.process_automated_alerts(background_tasks)


@router.get("/api/data/dashboard/summary")
async def get_dashboard_summary():
    """Get summary data for dashboard"""
    try:
        aggregated = await data_aggregator.aggregate_all_data()
        
        # Calculate summary statistics
        threats = aggregated['active_threats']
        
        severity_counts = Counter([t['severity_level'] for t in threats])
        hazard_counts = Counter([t['threat_type'] for t in threats])
        
        # Get top affected regions
        all_locations = []
        for threat in threats:
            all_locations.extend(threat['affected_locations'])
        location_counts = Counter(all_locations)
        
        return {
            'total_active_threats': len(threats),
            'severity_breakdown': dict(severity_counts),
            'hazard_type_breakdown': dict(hazard_counts),
            'top_affected_regions': dict(location_counts.most_common(10)),
            'data_freshness': aggregated['data_freshness'],
            'last_updated': aggregated['aggregation_timestamp'],
            'high_priority_count': len([t for t in threats if t['severity_level'] in ['high', 'critical']]),
            'average_confidence': np.mean([t['confidence_score'] for t in threats]) if threats else 0
        }
        
    except Exception as e:
        logger.error(f"Error generating dashboard summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate dashboard summary")


@router.get("/api/data/spatial/hotspots")
async def get_spatial_hotspots(radius: float = Query(20.0, description="Radius in kilometers")):
    """Get spatial hotspots of threats"""
    aggregated = await data_aggregator.aggregate_all_data()
    threats = aggregated['active_threats']
    
    hotspots = []
    for threat in threats:
        if threat['report_count'] >= 2:  # At least 2 reports
            hotspots.append({
                'id': threat['threat_id'],
                'center': threat['geographical_center'],
                'radius_km': threat['affected_radius_km'],
                'threat_type': threat['threat_type'],
                'severity': threat['severity_level'],
                'report_count': threat['report_count'],
                'confidence': threat['confidence_score'],
                'locations': threat['affected_locations']
            })
    
    # Sort by severity and confidence
    hotspots.sort(key=lambda x: (
        data_aggregator._severity_to_numeric(x['severity']) * x['confidence']
    ), reverse=True)
    
    return {'hotspots': hotspots}


@router.get("/api/data/trends")
async def get_threat_trends(hours: int = Query(24, description="Time window in hours")):
    """Get threat trends over time"""
    # This would require historical data analysis
    # For now, return mock trend data
    return {
        'time_window_hours': hours,
        'trends': [
            {
                'hazard_type': 'coastal_flooding',
                'trend': 'increasing',
                'change_percent': 23.5,
                'current_count': 15,
                'previous_count': 12
            },
            {
                'hazard_type': 'cyclone',
                'trend': 'stable',
                'change_percent': 2.1,
                'current_count': 8,
                'previous_count': 7
            }
        ]
    }